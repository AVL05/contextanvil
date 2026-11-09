#!/usr/bin/env node
/**
 * Runs one scan + one context compilation in a fresh process and prints
 * timing, peak memory and content hashes as JSON. Used by bench/run.js for
 * cold-start timing, peak RSS and cross-process determinism checks.
 *
 *   node bench/child.js <engine index.js> <repo dir> "<task>"
 */
import crypto from 'node:crypto';
import { pathToFileURL } from 'node:url';

const [engine, repo, task] = process.argv.slice(2);
const api = await import(pathToFileURL(engine).href);
const sha = (s) => crypto.createHash('sha256').update(s).digest('hex').slice(0, 16);

const t0 = performance.now();
const scan = api.scanRepository(repo);
const t1 = performance.now();
const pack = api.compileContext(scan, task);
const t2 = performance.now();
const report = api.diagnose(scan);
const t3 = performance.now();

console.log(JSON.stringify({
  scanMs: t1 - t0,
  compileMs: t2 - t1,
  doctorMs: t3 - t2,
  maxRssMB: process.resourceUsage().maxRSS / 1024,
  heapUsedMB: process.memoryUsage().heapUsed / 1048576,
  files: scan.files.length,
  scanHash: sha(JSON.stringify(scan)),
  packHash: sha(JSON.stringify(pack)),
  doctorHash: sha(JSON.stringify(report)),
}));
