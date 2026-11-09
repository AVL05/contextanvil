#!/usr/bin/env node
/**
 * ContextAnvil benchmark runner. See bench/README.md for methodology.
 *
 *   node bench/run.js [--engine <index.js>] [--label <text>] [--out <json>] [--md <md>]
 *                     [--quick] [--no-perf] [--runs <n>]
 *
 * --engine lets the same benchmark run against another build (for example a
 * saved copy of an earlier version) so before/after numbers come from the same
 * dataset and the same code path.
 */
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { generateScaleRepo, materialize } from './lib/materialize.js';
import { mean, median, precisionAtK, ranksOf, recallAtK, reciprocalRank, round, rPrecision } from './lib/metrics.js';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const args = process.argv.slice(2);
const flag = (name) => args.includes(`--${name}`);
const value = (name, fallback) => (args.includes(`--${name}`) ? args[args.indexOf(`--${name}`) + 1] : fallback);

const engine = path.resolve(value('engine', path.join(HERE, '..', 'src', 'index.js')));
const label = value('label', 'current');
const quick = flag('quick');
const showHoldout = flag('show-holdout');
const runs = Number(value('runs', quick ? 3 : 7));
const api = await import(pathToFileURL(engine).href);
const version = api.VERSION ?? 'unknown';

const datasets = JSON.parse(fs.readFileSync(path.join(HERE, 'datasets', 'tasks.json'), 'utf8'));
const KS = [1, 3, 5];

function evaluateTask(scan, task) {
  // A very large budget and --top 50 so the budget never truncates the ranking being measured.
  const ranked = api.compileContext(scan, task.task, { budget: '4096kb', top: 50 }).files.map((f) => f.path);
  const rel = task.relevant;
  const missing = rel.filter((p) => !scan.files.some((f) => f.path === p));
  if (missing.length) throw new Error(`Task ${task.id}: relevant files not in repository: ${missing.join(', ')}`);
  const metrics = {
    'P@1': precisionAtK(ranked, rel, 1),
    'P@3': precisionAtK(ranked, rel, 3),
    'P@5': precisionAtK(ranked, rel, 5),
    'R@3': recallAtK(ranked, rel, 3),
    'R@5': recallAtK(ranked, rel, 5),
    'R@8': recallAtK(ranked, rel, 8),
    MRR: reciprocalRank(ranked, rel),
    'R-precision': rPrecision(ranked, rel),
  };
  const pack = api.compileContext(scan, task.task); // default budget: what a user actually receives
  const inPack = rel.filter((p) => pack.files.some((f) => f.path === p)).length;
  return {
    id: task.id, split: task.split, task: task.task, relevant: rel, top5: ranked.slice(0, 5),
    ranks: ranksOf(ranked, rel), metrics,
    packBytes: Buffer.byteLength(pack.rendered), packRecall: inPack / rel.length,
  };
}

function aggregate(rows) {
  if (!rows.length) return null;
  const keys = Object.keys(rows[0].metrics);
  return {
    tasks: rows.length,
    ...Object.fromEntries(keys.map((k) => [k, round(mean(rows.map((r) => r.metrics[k])))])),
    packRecall: round(mean(rows.map((r) => r.packRecall))),
    packBytes: Math.round(mean(rows.map((r) => r.packBytes))),
  };
}
const bySplit = (rows) => ({ dev: aggregate(rows.filter((r) => r.split === 'dev')), holdout: aggregate(rows.filter((r) => r.split === 'holdout')), all: aggregate(rows) });

function childRun(repo, task) {
  const r = spawnSync(process.execPath, [path.join(HERE, 'child.js'), engine, repo, task], { encoding: 'utf8', timeout: 300000 });
  if (r.status !== 0) throw new Error(`child failed: ${r.stderr.slice(0, 300)}`);
  return JSON.parse(r.stdout);
}

/** One discarded warm-up process (file cache, antivirus scans of fresh files), then the median of n measured processes. */
function childMedian(repo, task, n) {
  childRun(repo, task);
  const samples = Array.from({ length: n }, () => childRun(repo, task));
  const med = (key) => median(samples.map((s) => s[key]));
  return { files: samples[0].files, scanMs: med('scanMs'), compileMs: med('compileMs'), doctorMs: med('doctorMs'), maxRssMB: med('maxRssMB') };
}

const result = {
  meta: { label, engineVersion: version, node: process.version, platform: `${process.platform}-${process.arch}`, cpus: os.cpus().length, cpuModel: os.cpus()[0]?.model ?? 'unknown', quick, runsPerTiming: runs },
  ranking: [], performance: [], scale: [], determinism: [],
};
const cleanups = [];

for (const ds of datasets.datasets) {
  const repo = materialize(HERE, ds.source);
  cleanups.push(repo.cleanup);
  const scan = api.scanRepository(repo.dir);
  const rows = ds.tasks.map((t) => evaluateTask(scan, t));
  const textBytes = scan.files.filter((f) => /\.(js|jsx|ts|tsx|php|md|json|ya?ml|xml)$/.test(f.path)).reduce((n, f) => n + f.size, 0);
  result.ranking.push({ id: ds.id, kind: ds.kind, files: scan.files.length, repoTextBytes: textBytes, tasks: rows, aggregate: bySplit(rows) });

  if (!flag('no-perf')) {
    const scanTimes = [];
    const compileTimes = [];
    api.scanRepository(repo.dir); // warm-up, discarded
    for (let i = 0; i < runs; i++) {
      const t0 = performance.now();
      const s = api.scanRepository(repo.dir);
      const t1 = performance.now();
      api.compileContext(s, ds.tasks[0].task);
      scanTimes.push(t1 - t0);
      compileTimes.push(performance.now() - t1);
    }
    const cold = childRun(repo.dir, ds.tasks[0].task);
    const cold2 = childRun(repo.dir, ds.tasks[0].task);
    result.performance.push({
      id: ds.id, files: scan.files.length,
      scanMsMedian: round(median(scanTimes), 1), compileMsMedian: round(median(compileTimes), 1),
      coldProcessScanMs: round(cold.scanMs, 1), coldProcessMaxRssMB: round(cold.maxRssMB, 1),
    });
    result.determinism.push({ id: ds.id, crossProcessIdentical: cold.scanHash === cold2.scanHash && cold.packHash === cold2.packHash && cold.doctorHash === cold2.doctorHash });
  }
}

if (!flag('no-perf')) {
  for (const n of quick ? [500] : [500, 2000, 5000]) {
    const repo = generateScaleRepo(n);
    cleanups.push(repo.cleanup);
    const c = childMedian(repo.dir, 'update module 42 helper', quick ? 1 : 3);
    result.scale.push({ files: c.files, scanMs: round(c.scanMs, 0), compileMs: round(c.compileMs, 0), doctorMs: round(c.doctorMs, 0), maxRssMB: round(c.maxRssMB, 0) });
  }
  const local = (process.env.BENCH_LOCAL_REPOS ?? '').split(path.delimiter).filter(Boolean);
  result.local = local.map((dir, i) => {
    const c = childMedian(dir, 'update the main component', quick ? 1 : 3);
    return { id: `local-${i + 1}`, files: c.files, scanMs: round(c.scanMs, 0), compileMs: round(c.compileMs, 0), maxRssMB: round(c.maxRssMB, 0) };
  });
}
for (const c of cleanups) c();

const by = (kind) => result.ranking.filter((d) => d.kind === kind).flatMap((d) => d.tasks);
result.summary = { synthetic: bySplit(by('synthetic')), real: bySplit(by('real')) };

const out = value('out');
if (out) fs.writeFileSync(out, `${JSON.stringify(result, null, 2)}\n`);
const md = renderMarkdown(result);
if (value('md')) fs.writeFileSync(value('md'), md);
console.log(md);

function short(p) {
  return p.split('/').slice(-2).join('/');
}

function renderMarkdown(r) {
  const f = (n) => (n === null || n === undefined ? '-' : n.toFixed(2));
  const row = (name, a) => (a ? `| ${name} | ${a.tasks} | ${f(a['P@1'])} | ${f(a['P@3'])} | ${f(a['R@3'])} | ${f(a['R@5'])} | ${f(a['R@8'])} | ${f(a.MRR)} | ${f(a['R-precision'])} | ${f(a.packRecall)} |` : '');
  const lines = [`# ContextAnvil benchmark: ${r.meta.label} (engine v${r.meta.engineVersion})`, '',
    `Node ${r.meta.node} on ${r.meta.platform}, ${r.meta.cpus} CPUs (${r.meta.cpuModel}). Timing runs per measurement: ${r.meta.runsPerTiming}.`, '',
    '## Ranking quality (macro-average over tasks)', '',
    '| Set | Tasks | P@1 | P@3 | R@3 | R@5 | R@8 | MRR | R-prec | Pack recall |', '|---|---|---|---|---|---|---|---|---|---|'];
  for (const kind of ['synthetic', 'real']) {
    for (const split of ['dev', 'holdout', 'all']) lines.push(row(`${kind} / ${split}`, r.summary[kind][split]));
  }
  lines.push('', 'Pack recall = share of relevant files that appear in the default-budget (3000 estimated tokens) pack.', '', '## Per dataset (all tasks)', '', '| Dataset | Kind | Files | Tasks | P@1 | R@3 | MRR | R-prec | Pack bytes (mean) | Repo text bytes |', '|---|---|---|---|---|---|---|---|---|---|');
  for (const d of r.ranking) lines.push(`| ${d.id} | ${d.kind} | ${d.files} | ${d.aggregate.all.tasks} | ${f(d.aggregate.all['P@1'])} | ${f(d.aggregate.all['R@3'])} | ${f(d.aggregate.all.MRR)} | ${f(d.aggregate.all['R-precision'])} | ${d.aggregate.all.packBytes} | ${d.repoTextBytes} |`);
  lines.push('', showHoldout ? '## Per task' : '## Per task (dev split only; holdout rows are hidden unless --show-holdout)', '', '| Task | Split | R-prec | Ranks of relevant files | Top 3 returned |', '|---|---|---|---|---|');
  for (const d of r.ranking) for (const t of d.tasks.filter((x) => showHoldout || x.split === 'dev')) lines.push(`| ${t.id} | ${t.split} | ${f(t.metrics['R-precision'])} | ${Object.entries(t.ranks).map(([p, k]) => `${short(p)}:${k ?? 'miss'}`).join(' ')} | ${t.top5.slice(0, 3).map(short).join(', ')} |`);
  if (r.performance.length) {
    lines.push('', '## Performance (this machine only)', '', '| Dataset | Files | Scan ms (median, warm) | Compile ms (median) | Cold process scan ms (1 run) | Cold process peak RSS MB |', '|---|---|---|---|---|---|');
    for (const p of r.performance) lines.push(`| ${p.id} | ${p.files} | ${p.scanMsMedian} | ${p.compileMsMedian} | ${p.coldProcessScanMs} | ${p.coldProcessMaxRssMB} |`);
    lines.push('', '### Synthetic scale (generated repositories, median of 3 fresh processes after 1 warm-up)', '', '| Files | Scan ms | Compile ms | Doctor ms | Peak RSS MB |', '|---|---|---|---|---|');
    for (const s of r.scale) lines.push(`| ${s.files} | ${s.scanMs} | ${s.compileMs} | ${s.doctorMs} | ${s.maxRssMB} |`);
    if (r.local?.length) {
      lines.push('', '### Local real repositories (private; anonymised; timing only)', '', '| Repo | Files | Scan ms | Compile ms | Peak RSS MB |', '|---|---|---|---|---|');
      for (const s of r.local) lines.push(`| ${s.id} | ${s.files} | ${s.scanMs} | ${s.compileMs} | ${s.maxRssMB} |`);
    }
    lines.push('', '## Determinism', '', `Each dataset was scanned, compiled and diagnosed in two separate processes: ${r.determinism.every((d) => d.crossProcessIdentical) ? 'all outputs were byte-identical' : 'DIFFERENCES FOUND: ' + r.determinism.filter((d) => !d.crossProcessIdentical).map((d) => d.id).join(', ')}.`);
  }
  return `${lines.join('\n')}\n`;
}
