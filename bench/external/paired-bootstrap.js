#!/usr/bin/env node
/**
 * Paired bootstrap confidence intervals for the difference between two engines on the same tasks.
 *   node bench/external/paired-bootstrap.js results/run-1.json <engineA> <engineB>
 * Reports mean(B) - mean(A) with a 95% percentile interval over 10,000 resamples of tasks (fixed seed, so reproducible).
 * With a few dozen tasks the intervals are wide; an interval containing 0 means the difference is not distinguishable
 * from noise on this sample.
 */
import fs from 'node:fs';

const [file, a, b] = process.argv.slice(2);
const run = JSON.parse(fs.readFileSync(file, 'utf8'));
const A = run.engines[a].tasks;
const B = run.engines[b].tasks;

let seed = 123456789;
const rand = () => {
  seed = (seed * 1664525 + 1013904223) >>> 0;
  return seed / 2 ** 32;
};

console.log(`Paired bootstrap, ${b} minus ${a}, rankable labels, 10,000 resamples (seed fixed)\n`);
console.log('| Metric | Tasks | Mean A | Mean B | Difference | 95% interval | Distinguishable from 0 |');
console.log('|---|---|---|---|---|---|---|');
for (const key of ['P@1', 'MRR', 'R-precision', 'R@5', 'R@8']) {
  const pairs = A.map((t, i) => [t.metrics.rankable?.[key], B[i].metrics.rankable?.[key]]).filter(([x, y]) => x !== undefined && y !== undefined);
  const diffs = pairs.map(([x, y]) => y - x);
  const mean = (v) => v.reduce((s, x) => s + x, 0) / v.length;
  const samples = [];
  for (let i = 0; i < 10000; i++) {
    let s = 0;
    for (let j = 0; j < diffs.length; j++) s += diffs[Math.floor(rand() * diffs.length)];
    samples.push(s / diffs.length);
  }
  samples.sort((x, y) => x - y);
  const lo = samples[Math.floor(0.025 * samples.length)];
  const hi = samples[Math.floor(0.975 * samples.length)];
  console.log(`| ${key} | ${pairs.length} | ${mean(pairs.map((p) => p[0])).toFixed(3)} | ${mean(pairs.map((p) => p[1])).toFixed(3)} | ${mean(diffs) >= 0 ? '+' : ''}${mean(diffs).toFixed(3)} | [${lo.toFixed(3)}, ${hi.toFixed(3)}] | ${lo > 0 || hi < 0 ? 'yes' : 'no'} |`);
}
