#!/usr/bin/env node
/**
 * Print the ranking and the reasons behind it for one benchmark task.
 *   node bench/explain.js <dataset id> <task id> [--top n] [--engine path]
 * Holdout tasks are refused unless --show-holdout is given.
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { materialize } from './lib/materialize.js';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const argv = process.argv.slice(2);
const opt = (name, fallback) => (argv.includes(`--${name}`) ? argv[argv.indexOf(`--${name}`) + 1] : fallback);
const [dsId, taskId] = argv;
const api = await import(pathToFileURL(path.resolve(opt('engine', path.join(HERE, '..', 'src', 'index.js')))).href);
const data = JSON.parse(fs.readFileSync(path.join(HERE, 'datasets', 'tasks.json'), 'utf8'));
const ds = data.datasets.find((d) => d.id === dsId);
const task = ds?.tasks.find((t) => t.id === taskId);
if (!task) { console.error('unknown dataset/task'); process.exit(2); }
if (task.split === 'holdout' && !argv.includes('--show-holdout')) { console.error('holdout task: pass --show-holdout to inspect it'); process.exit(2); }
const repo = materialize(HERE, ds.source);
try {
  const scan = api.scanRepository(repo.dir);
  const pack = api.compileContext(scan, task.task, { budget: '4096kb', top: Number(opt('top', 8)) });
  console.log(`${task.task}\nintent: ${pack.task.intent?.name ?? 'n/a'}; terms: ${JSON.stringify(pack.task.termWeights ?? pack.task.terms)}`);
  console.log(`relevant: ${task.relevant.join(', ')}`);
  for (const [i, f] of pack.files.entries()) {
    console.log(`${i + 1}. ${task.relevant.includes(f.path) ? '*' : ' '} ${f.path}  ${f.score}`);
    for (const r of f.reasons.filter((x) => x.points)) console.log(`      +${r.points} ${r.detail}`);
  }
  for (const p of task.relevant) {
    if (!pack.files.some((f) => f.path === p)) console.log(`   (relevant file not in top ${opt('top', 8)}: ${p})`);
  }
} finally {
  repo.cleanup();
}
