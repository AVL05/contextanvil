import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { compileContext, scanRepository } from '../../src/index.js';
import { experimentOptions } from '../../src/compiler/experiment.js';
import { mean, median, precisionAtK, recallAtK, reciprocalRank, rPrecision } from '../lib/metrics.js';

const self = fileURLToPath(import.meta.url);
const [root, split, mode, query, trace] = process.argv.slice(2);
const variants = ['baseline', 'v2', 'no-graph-candidates', 'union', 'no-graph-score', 'no-barrel', 'legacy-pack'];

function runCompile(scan, task, variant, diagnostic) {
  let time = performance.now();
  const stages = {};
  const experiment = {
    variant,
    mark(stage) {
      const now = performance.now();
      stages[stage] = now - time;
      time = now;
    },
  };
  const pack = compileContext(scan, task, {
    relevanceV2: variant !== 'baseline', retrievalDiagnostics: true, budget: '8192b',
    ...(diagnostic && { [experimentOptions]: experiment }),
  });
  return { pack, stages, retrieval: experiment.retrieval, selection: experiment.pack };
}

function diagnose(row, relevant) {
  const before = row.baseline;
  const after = row.v2;
  const losses = [];
  for (const file of relevant) {
    const oldRank = before.ranked.indexOf(file);
    const newRank = after.ranked.indexOf(file);
    const candidateLost = before.candidatePaths.includes(file) && !after.candidatePaths.includes(file);
    const packLost = before.packed.includes(file) && !after.packed.includes(file);
    const rankLost = oldRank >= 0 && (newRank < 0 || newRank > oldRank);
    if (!candidateLost && !packLost && !rankLost) continue;
    const stage = candidateLost ? 'candidate'
      : packLost && after.selection.considered.includes(file) ? 'budget' : 'ranking';
    losses.push({
      file, stage, candidateLost, rankLost, packLost,
      oldRank: oldRank < 0 ? null : oldRank + 1, newRank: newRank < 0 ? null : newRank + 1,
      quota: after.retrieval.displaced.includes(file),
    });
  }
  return losses;
}

if (mode === 'worker') {
  const start = performance.now();
  const scan = scanRepository(root);
  const firstRun = runCompile(scan, query, split, trace === 'trace');
  const first = firstRun.pack;
  const coldMs = performance.now() - start;
  const warmStart = performance.now();
  const secondRun = runCompile(scan, query, split, trace === 'trace');
  const second = secondRun.pack;
  const warmMs = performance.now() - warmStart;
  assert.equal(JSON.stringify(first), JSON.stringify(second));
  assert.deepEqual(firstRun.retrieval, secondRun.retrieval);
  assert.deepEqual(firstRun.selection, secondRun.selection);
  console.log(JSON.stringify({
    candidatePaths: first.retrieval.candidates,
    ranked: first.retrieval.ranked.map((f) => f.path),
    packed: first.files.map((f) => f.path),
    bytes: first.budget.usedBytes, coldMs, warmMs, rssKiB: process.resourceUsage().maxRSS,
    ...(trace === 'trace' && {
      retrieval: firstRun.retrieval, selection: firstRun.selection,
      coldStages: firstRun.stages, warmStages: secondRun.stages,
    }),
  }));
} else {
  assert.ok(root && ['dev', 'holdout'].includes(split) && (!mode || mode === 'diagnose'),
    'Usage: node evaluate.js <clone directory> <dev|holdout> [diagnose]');
  const input = fs.readFileSync(new URL('./labels.json', import.meta.url));
  const hash = crypto.createHash('sha256').update(input).digest('hex');
  assert.equal(hash, 'e43d8a289899ecbf1158770fe37785e8b38b8cab0d3826e0a538aa7f65a42a27');
  const labels = JSON.parse(input);
  const repositories = split === 'dev' ? ['ky', 'preact'] : ['express', 'framework', 'underscore'];
  const rows = [];
  for (const task of labels.tasks.filter((t) => repositories.includes(t.repo))) {
    const relevant = task.relevant.filter((f) => f.rankable).map((f) => f.path);
    if (!relevant.length) continue;
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'anvil-v2-'));
    try {
      const archive = execFileSync('git', ['-C', path.join(root, task.repo), 'archive', task.parent], { maxBuffer: 128 * 1024 * 1024 });
      execFileSync('tar', ['-xf', '-', '-C', dir], { input: archive });
      const row = { repo: task.repo, id: task.id };
      const engines = mode === 'diagnose' && split === 'dev' ? variants : variants.slice(0, 2);
      const ordered = rows.length % 2 ? [...engines].reverse() : engines;
      for (const engine of ordered) {
        const data = JSON.parse(execFileSync(process.execPath, [self, dir, engine, 'worker', task.task, mode ? 'trace' : ''], {
          encoding: 'utf8', maxBuffer: 16 * 1024 * 1024,
        }));
        const { candidatePaths, ranked, packed, ...cost } = data;
        row[engine] = {
          candidate: recallAtK(candidatePaths, relevant, 64),
          p1: precisionAtK(ranked, relevant, 1),
          mrr: reciprocalRank(ranked, relevant),
          rp: rPrecision(ranked, relevant),
          pack: recallAtK(packed, relevant, packed.length),
          ...cost,
          ...(mode && {
            candidatePaths, ranked, packed,
            missing: relevant.filter((file) => !candidatePaths.includes(file)),
            topNonLabels: ranked.slice(0, 8).filter((file) => !relevant.includes(file)),
            labelledHitsPerKiB: 1024 * packed.filter((file) => relevant.includes(file)).length / data.bytes,
          }),
        };
      }
      if (mode) row.losses = diagnose(row, relevant);
      rows.push(row);
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  }

  const groups = repositories.map((repo) => rows.filter((row) => row.repo === repo));
  const summary = {};
  for (const metric of ['candidate', 'p1', 'mrr', 'rp', 'pack', 'bytes', 'coldMs', 'warmMs', 'rssKiB']) {
    const cost = ['coldMs', 'warmMs', 'rssKiB'].includes(metric);
    const aggregate = (engine) => cost
      ? median(rows.map((row) => row[engine][metric]))
      : mean(groups.map((group) => mean(group.map((row) => row[engine][metric]))));
    const effects = groups.map((group) => mean(group.map((row) => row.v2[metric] - row.baseline[metric])));
    // Enumerate every equally likely repository bootstrap sample for this small pilot.
    let boot = [0];
    for (const _ of groups) boot = boot.flatMap((sum) => effects.map((effect) => sum + effect / groups.length));
    boot.sort((a, b) => a - b);
    summary[metric] = { baseline: aggregate('baseline'), v2: aggregate('v2') };
    if (!cost) Object.assign(summary[metric], {
      repositoryEffects: effects,
      interval95: [boot[Math.floor(boot.length * 0.025)], boot[Math.ceil(boot.length * 0.975) - 1]],
    });
  }
  const ablations = mode && split === 'dev' ? Object.fromEntries(variants.map((variant) => [
    variant, Object.fromEntries(['candidate', 'p1', 'mrr', 'rp', 'pack', 'bytes', 'coldMs', 'warmMs', 'rssKiB']
      .map((metric) => [metric, mean(groups.map((group) => mean(group.map((row) => row[variant][metric]))))])),
  ])) : undefined;
  console.log(JSON.stringify({ split, node: process.version, platform: process.platform, repositories, summary, ablations, rows }, null, 2));
}
