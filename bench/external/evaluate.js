#!/usr/bin/env node
/**
 * Evaluate ranking engines against the frozen external labels.
 *
 *   node bench/external/evaluate.js --repo alias=/path/to/repo [--repo ...] \
 *       --engine current=src/index.js [--engine v0.1.0=bench/engines/v0.1.0/src/index.js] \
 *       --out bench/external/results/run.json --md bench/external/results/run.md
 *
 * The repositories are only read: each task's tree is extracted with `git archive` of the parent commit into a
 * temporary directory. Labels are verified against the frozen hash first.
 *
 * Metrics are reported on two label sets. "Rankable" counts only labels ContextAnvil can rank at all (source, test,
 * documentation and configuration text). "All" counts every changed file, including CSS, dotfiles and the like, which
 * no ranking of text files can return; it shows how much of real change sets is out of reach.
 */
import { spawnSync } from 'node:child_process';
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { mean, median, precisionAtK, ranksOf, recallAtK, reciprocalRank, round, rPrecision } from '../lib/metrics.js';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const FROZEN_SHA256 = 'a8205f3bb53eef6b2d96a957e43a5cd0a6d2b672d65399831e0d27c530ce69af';
const argv = process.argv.slice(2);
const all = (name) => argv.flatMap((a, i) => (a === `--${name}` ? [argv[i + 1]] : []));
const one = (name) => all(name)[0];

const raw = fs.readFileSync(path.join(HERE, 'labels.json'), 'utf8');
const actual = crypto.createHash('sha256').update(raw).digest('hex');
if (actual !== FROZEN_SHA256) {
  console.error(`labels.json does not match the frozen hash.\n  expected ${FROZEN_SHA256}\n  actual   ${actual}`);
  process.exit(2);
}
const labels = JSON.parse(raw);

const repos = Object.fromEntries(all('repo').map((r) => [r.slice(0, r.indexOf('=')), r.slice(r.indexOf('=') + 1)]));
const engines = all('engine').map((e) => ({ name: e.slice(0, e.indexOf('=')), file: path.resolve(e.slice(e.indexOf('=') + 1)) }));
if (!engines.length) engines.push({ name: 'current', file: path.resolve(HERE, '..', '..', 'src', 'index.js') });
for (const alias of Object.keys(labels.repos)) if (!repos[alias]) { console.error(`missing --repo ${alias}=<path>`); process.exit(2); }

function extractParent(repo, parent) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'contextanvil-ext-'));
  const archive = spawnSync('git', ['-C', repo, 'archive', '--format=tar', parent], { maxBuffer: 512 * 1024 * 1024 });
  if (archive.status !== 0) throw new Error(`git archive failed: ${archive.stderr}`);
  const untar = spawnSync('tar', ['-x', '-C', dir], { input: archive.stdout, maxBuffer: 1024 * 1024 });
  if (untar.status !== 0) throw new Error(`tar failed: ${untar.stderr}`);
  return dir;
}

const results = { meta: { node: process.version, platform: `${process.platform}-${process.arch}`, labelsSha256: actual, tasks: labels.tasks.length, repos: labels.repos }, engines: {} };
for (const e of engines) results.engines[e.name] = { tasks: [] };
const apis = {};
for (const e of engines) apis[e.name] = await import(pathToFileURL(e.file).href);
for (const e of engines) results.engines[e.name].version = apis[e.name].VERSION;

for (const task of labels.tasks) {
  const dir = extractParent(repos[task.repo], task.parent);
  try {
    for (const e of engines) {
      const api = apis[e.name];
      const t0 = performance.now();
      const scan = api.scanRepository(dir);
      const t1 = performance.now();
      const ranked = api.compileContext(scan, task.task, { budget: '4096kb', top: 50 }).files.map((f) => f.path);
      const t2 = performance.now();
      const pack = api.compileContext(scan, task.task);
      const t3 = performance.now();
      const indexed = new Set(scan.files.map((f) => f.path));
      const sets = {
        all: task.relevant.map((r) => r.path),
        rankable: task.relevant.filter((r) => r.rankable).map((r) => r.path),
      };
      const metricsFor = (rel) => (rel.length ? {
        'P@1': precisionAtK(ranked, rel, 1), MRR: reciprocalRank(ranked, rel), 'R-precision': rPrecision(ranked, rel),
        'R@5': recallAtK(ranked, rel, 5), 'R@3': recallAtK(ranked, rel, 3), 'R@8': recallAtK(ranked, rel, 8),
        packRecall: rel.filter((p) => pack.files.some((f) => f.path === p)).length / rel.length,
      } : null);
      results.engines[e.name].tasks.push({
        id: task.id, repo: task.repo, task: task.task, relevantAll: sets.all.length, relevantRankable: sets.rankable.length,
        notIndexed: sets.rankable.filter((p) => !indexed.has(p)),
        ranks: ranksOf(ranked, sets.all), top5: ranked.slice(0, 5),
        metrics: { rankable: metricsFor(sets.rankable), all: metricsFor(sets.all) },
        packBytes: Buffer.byteLength(pack.rendered), repoFiles: scan.files.length,
        scanMs: t1 - t0, compileMs: t2 - t1, defaultCompileMs: t3 - t2,
      });
    }
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
}

const KEYS = ['P@1', 'MRR', 'R-precision', 'R@3', 'R@5', 'R@8', 'packRecall'];
function aggregate(tasks, set) {
  const rows = tasks.filter((t) => t.metrics[set]);
  return {
    tasks: rows.length,
    ...Object.fromEntries(KEYS.map((k) => [k, round(mean(rows.map((t) => t.metrics[set][k])))])),
    packBytesMean: Math.round(mean(tasks.map((t) => t.packBytes))),
    scanMsMedian: round(median(tasks.map((t) => t.scanMs)), 1),
    compileMsMedian: round(median(tasks.map((t) => t.compileMs)), 1),
  };
}
for (const e of engines) {
  const r = results.engines[e.name];
  r.summary = { rankable: aggregate(r.tasks, 'rankable'), all: aggregate(r.tasks, 'all') };
  r.byRepo = Object.fromEntries(Object.keys(labels.repos).map((alias) => {
    const ts = r.tasks.filter((t) => t.repo === alias);
    return [alias, { rankable: aggregate(ts, 'rankable'), all: aggregate(ts, 'all') }];
  }));
}
results.coverage = {
  labels: labels.tasks.reduce((n, t) => n + t.relevant.length, 0),
  rankableLabels: labels.tasks.reduce((n, t) => n + t.relevant.filter((r) => r.rankable).length, 0),
  tasksWithNoRankableLabel: labels.tasks.filter((t) => !t.relevant.some((r) => r.rankable)).length,
};

const f = (n) => (n === null || n === undefined ? '-' : n.toFixed(2));
const lines = ['# External ranking evaluation', '',
  `Labels sha256 ${actual} (frozen). Node ${process.version} on ${results.meta.platform}. ${labels.tasks.length} tasks over ${Object.keys(labels.repos).length} repositories.`,
  `Labels: ${results.coverage.labels}, of which ${results.coverage.rankableLabels} are files ContextAnvil can rank; ${results.coverage.tasksWithNoRankableLabel} tasks have no rankable label.`, '',
  '## Aggregate (macro-average over tasks)', '', '| Engine | Label set | Tasks | P@1 | MRR | R-precision | R@3 | R@5 | R@8 | Pack recall | Pack bytes | Scan ms (median) | Compile ms (median) |', '|---|---|---|---|---|---|---|---|---|---|---|---|---|'];
for (const e of engines) {
  for (const set of ['rankable', 'all']) {
    const a = results.engines[e.name].summary[set];
    lines.push(`| ${e.name} (v${results.engines[e.name].version}) | ${set} | ${a.tasks} | ${f(a['P@1'])} | ${f(a.MRR)} | ${f(a['R-precision'])} | ${f(a['R@3'])} | ${f(a['R@5'])} | ${f(a['R@8'])} | ${f(a.packRecall)} | ${a.packBytesMean} | ${a.scanMsMedian} | ${a.compileMsMedian} |`);
  }
}
lines.push('', '## Per repository (rankable labels)', '', '| Repo | Engine | Tasks | P@1 | MRR | R-precision | R@5 |', '|---|---|---|---|---|---|---|');
for (const alias of Object.keys(labels.repos)) for (const e of engines) {
  const a = results.engines[e.name].byRepo[alias].rankable;
  lines.push(`| ${alias} | ${e.name} | ${a.tasks} | ${f(a['P@1'])} | ${f(a.MRR)} | ${f(a['R-precision'])} | ${f(a['R@5'])} |`);
}
lines.push('', '## Every task (rankable labels; "rank" is the position of each relevant file, miss = not in the top 50)', '', '| Task | Repo | ' + engines.map((e) => `${e.name} R-prec | ${e.name} ranks`).join(' | ') + ' |', '|---|---|' + engines.map(() => '---|---').join('') );
labels.tasks.forEach((t, i) => {
  const cells = engines.map((e) => {
    const r = results.engines[e.name].tasks[i];
    const m = r.metrics.rankable;
    const ranks = Object.entries(r.ranks).filter(([p]) => labels.tasks[i].relevant.find((x) => x.path === p)?.rankable).map(([p, k]) => `${path.posix.basename(p)}:${k ?? 'miss'}`).join(' ');
    return `${m ? f(m['R-precision']) : '-'} | ${ranks || '(no rankable label)'}`;
  });
  lines.push(`| ${t.task.slice(0, 70)} | ${t.repo} | ${cells.join(' | ')} |`);
});
const md = `${lines.join('\n')}\n`;
if (one('out')) fs.writeFileSync(one('out'), `${JSON.stringify(results, null, 2)}\n`);
if (one('md')) fs.writeFileSync(one('md'), md);
console.log(md);
