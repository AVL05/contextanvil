import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { compileContext, scanRepository } from '../../src/index.js';
import { mean, median, precisionAtK, recallAtK, reciprocalRank, rPrecision } from '../lib/metrics.js';

const self = fileURLToPath(import.meta.url);
const [root, split, mode, query] = process.argv.slice(2);

if (mode === 'worker') {
  const start = performance.now();
  const scan = scanRepository(root);
  const options = { relevanceV2: split === 'v2', retrievalDiagnostics: true, budget: '8192b' };
  const first = compileContext(scan, query, options);
  const coldMs = performance.now() - start;
  const warmStart = performance.now();
  const second = compileContext(scan, query, options);
  const warmMs = performance.now() - warmStart;
  assert.equal(JSON.stringify(first), JSON.stringify(second));
  console.log(JSON.stringify({
    candidatePaths: first.retrieval.candidates,
    ranked: first.retrieval.ranked.map((f) => f.path),
    packed: first.files.map((f) => f.path),
    bytes: first.budget.usedBytes, coldMs, warmMs, rssKiB: process.resourceUsage().maxRSS,
  }));
} else {
  assert.ok(root && ['dev', 'holdout'].includes(split), 'Usage: node evaluate.js <clone directory> <dev|holdout>');
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
      for (const engine of rows.length % 2 ? ['v2', 'baseline'] : ['baseline', 'v2']) {
        const data = JSON.parse(execFileSync(process.execPath, [self, dir, engine, 'worker', task.task], { encoding: 'utf8' }));
        const { candidatePaths, ranked, packed, ...cost } = data;
        row[engine] = {
          candidate: recallAtK(candidatePaths, relevant, 64),
          p1: precisionAtK(ranked, relevant, 1),
          mrr: reciprocalRank(ranked, relevant),
          rp: rPrecision(ranked, relevant),
          pack: recallAtK(packed, relevant, packed.length),
          ...cost,
        };
      }
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
  console.log(JSON.stringify({ split, node: process.version, platform: process.platform, repositories, summary, rows }, null, 2));
}
