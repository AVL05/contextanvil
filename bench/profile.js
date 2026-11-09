#!/usr/bin/env node
/**
 * Phase timing and CPU profile of scan + compile on a generated repository.
 *
 *   node bench/profile.js [files=5000] [--engine path/to/src/index.js] [--cpu]
 *
 * Without --cpu: prints wall time of the scan and of each compile run (the first run is cold, later runs are warm).
 * With --cpu: re-executes itself under `node --cpu-prof` and prints self time aggregated by source function.
 */
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { generateScaleRepo } from './lib/materialize.js';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const args = process.argv.slice(2);
const n = Number(args.find((a) => /^\d+$/.test(a)) ?? 5000);
const engine = path.resolve(args.includes('--engine') ? args[args.indexOf('--engine') + 1] : path.join(HERE, '..', 'src', 'index.js'));

if (args.includes('--cpu') && !process.execArgv.some((a) => a.startsWith('--cpu-prof'))) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ca-prof-'));
  spawnSync(process.execPath, ['--cpu-prof', `--cpu-prof-dir=${dir}`, fileURLToPath(import.meta.url), String(n), '--engine', engine], { stdio: 'inherit' });
  const file = fs.readdirSync(dir).find((f) => f.endsWith('.cpuprofile'));
  const prof = JSON.parse(fs.readFileSync(path.join(dir, file), 'utf8'));
  const byId = new Map(prof.nodes.map((node) => [node.id, node]));
  const self = new Map();
  const dt = prof.timeDeltas;
  prof.samples.forEach((id, i) => {
    const cf = byId.get(id).callFrame;
    const key = `${cf.functionName || '(anonymous)'}  ${cf.url.replace(/^file:\/\/\/.*\/(src|bench)\//, '$1/')}:${cf.lineNumber + 1}`;
    self.set(key, (self.get(key) ?? 0) + (dt[i] ?? 0));
  });
  const total = [...self.values()].reduce((a, b) => a + b, 0);
  console.log(`\nCPU self time by function (total ${(total / 1000).toFixed(0)} ms, top 18):`);
  for (const [k, v] of [...self.entries()].sort((a, b) => b[1] - a[1]).slice(0, 18)) console.log(`${(v / 1000).toFixed(0).padStart(7)} ms ${(100 * v / total).toFixed(1).padStart(5)}%  ${k}`);
  fs.rmSync(dir, { recursive: true, force: true });
  process.exit(0);
}

const api = await import(pathToFileURL(engine).href);
const repo = generateScaleRepo(n);
try {
  const t0 = performance.now();
  const scan = api.scanRepository(repo.dir);
  const t1 = performance.now();
  console.log(`generated repository: ${scan.files.length} files; scan ${(t1 - t0).toFixed(0)} ms`);
  for (let i = 1; i <= 3; i++) {
    const a = performance.now();
    const pack = api.compileContext(scan, 'update module 42 helper');
    console.log(`compile #${i}${i === 1 ? ' (cold)' : ' (warm: reader cache populated)'}: ${(performance.now() - a).toFixed(0)} ms; pack ${Buffer.byteLength(pack.rendered)} bytes`);
  }
} finally {
  repo.cleanup();
}
