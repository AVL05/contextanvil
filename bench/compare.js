#!/usr/bin/env node
/**
 * Side-by-side comparison of two benchmark result files.
 *   node bench/compare.js <before.json> <after.json> [--md out.md]
 * Aggregates only: per-task holdout results are never printed.
 */
import fs from 'node:fs';

const args = process.argv.slice(2);
const [beforePath, afterPath] = args.filter((a) => !a.startsWith('--') && a !== args[args.indexOf('--md') + 1]);
const mdOut = args.includes('--md') ? args[args.indexOf('--md') + 1] : null;
const before = JSON.parse(fs.readFileSync(beforePath, 'utf8'));
const after = JSON.parse(fs.readFileSync(afterPath, 'utf8'));

const f = (n) => (n === null || n === undefined ? '-' : n.toFixed(2));
const delta = (a, b) => {
  if (a === null || b === null || a === undefined || b === undefined) return '-';
  const d = b - a;
  return `${d >= 0 ? '+' : ''}${d.toFixed(2)}`;
};
const METRICS = ['P@1', 'P@3', 'R@3', 'R@5', 'R@8', 'MRR', 'R-precision', 'packRecall'];

const lines = [
  `# Before / after: ${before.meta.label} -> ${after.meta.label}`, '',
  `Before: engine v${before.meta.engineVersion}. After: engine v${after.meta.engineVersion}. Node ${after.meta.node} on ${after.meta.platform}.`,
  'Same datasets, same labels, same harness; only the engine differs.', '',
  '## Ranking quality (macro-average over tasks)', '',
  '| Set | Tasks | Metric | Before | After | Change |', '|---|---|---|---|---|---|',
];
for (const kind of ['synthetic', 'real']) {
  for (const split of ['dev', 'holdout', 'all']) {
    const b = before.summary[kind][split];
    const a = after.summary[kind][split];
    if (!a || !b) continue;
    for (const m of METRICS) lines.push(`| ${kind} / ${split} | ${a.tasks} | ${m} | ${f(b[m])} | ${f(a[m])} | ${delta(b[m], a[m])} |`);
  }
}
lines.push('', 'Pack recall = share of relevant files present in the default-budget (3000 estimated tokens) pack.', '', '## Per dataset (all tasks)', '', '| Dataset | Metric | Before | After | Change |', '|---|---|---|---|---|');
for (const d of after.ranking) {
  const b = before.ranking.find((x) => x.id === d.id);
  for (const m of ['MRR', 'R-precision', 'R@3']) lines.push(`| ${d.id} | ${m} | ${f(b.aggregate.all[m])} | ${f(d.aggregate.all[m])} | ${delta(b.aggregate.all[m], d.aggregate.all[m])} |`);
}
lines.push('', '## Tasks that got better or worse (R-precision, all splits; task text shown only for dev)', '');
let better = 0;
let worse = 0;
let same = 0;
for (const d of after.ranking) {
  const b = before.ranking.find((x) => x.id === d.id);
  for (const t of d.tasks) {
    const bt = b.tasks.find((x) => x.id === t.id);
    const diff = t.metrics['R-precision'] - bt.metrics['R-precision'];
    if (diff > 0.001) better++;
    else if (diff < -0.001) worse++;
    else same++;
  }
}
lines.push(`Across ${better + worse + same} tasks: ${better} improved, ${worse} regressed, ${same} unchanged (R-precision).`);

if (before.performance?.length && after.performance?.length) {
  lines.push('', '## Performance (same machine, medians; single-machine numbers are indicative only)', '', '| Dataset | Files | Scan ms before | Scan ms after | Compile ms before | Compile ms after | Cold peak RSS MB before | after |', '|---|---|---|---|---|---|---|---|');
  for (const p of after.performance) {
    const b = before.performance.find((x) => x.id === p.id);
    lines.push(`| ${p.id} | ${p.files} | ${b.scanMsMedian} | ${p.scanMsMedian} | ${b.compileMsMedian} | ${p.compileMsMedian} | ${b.coldProcessMaxRssMB} | ${p.coldProcessMaxRssMB} |`);
  }
  lines.push('', '### Synthetic scale (generated repositories; median of 3 fresh processes after a warm-up)', '', '| Files | Scan ms before | after | Compile ms before | after | Peak RSS MB before | after |', '|---|---|---|---|---|---|---|');
  for (const s of after.scale) {
    const b = before.scale.find((x) => x.files === s.files);
    lines.push(`| ${s.files} | ${b?.scanMs ?? '-'} | ${s.scanMs} | ${b?.compileMs ?? '-'} | ${s.compileMs} | ${b?.maxRssMB ?? '-'} | ${s.maxRssMB} |`);
  }
  if (after.local?.length) {
    lines.push('', '### Local real repositories (private, anonymised; timing only)', '', '| Repo | Files | Scan ms before | after | Compile ms before | after | Peak RSS MB before | after |', '|---|---|---|---|---|---|---|---|');
    for (const s of after.local) {
      const b = before.local?.find((x) => x.id === s.id);
      lines.push(`| ${s.id} | ${s.files} | ${b?.scanMs ?? '-'} | ${s.scanMs} | ${b?.compileMs ?? '-'} | ${s.compileMs} | ${b?.maxRssMB ?? '-'} | ${s.maxRssMB} |`);
    }
  }
  const det = (r) => r.determinism.every((d) => d.crossProcessIdentical);
  lines.push('', '## Determinism', '', `Two separate processes produced byte-identical scan, pack and doctor output for every dataset: before ${det(before) ? 'yes' : 'NO'}, after ${det(after) ? 'yes' : 'NO'}.`);
}
const text = `${lines.join('\n')}\n`;
if (mdOut) fs.writeFileSync(mdOut, text);
console.log(text);
