#!/usr/bin/env node
/**
 * Freeze a repository into a single JSON file so benchmark results stay
 * reproducible while the project keeps evolving.
 *
 *   node bench/make-snapshot.js <repo> <out.json> [label] [--drop <regex>]
 *
 * Uses ContextAnvil's own walker, so ignore rules, sensitive-file exclusion
 * and size limits apply. Only text files are stored.
 *
 * --drop removes every line matching the regex from every stored file. It
 * exists to remove text that would leak a benchmark answer (for example
 * documentation that discusses a benchmark task). Every use must be documented
 * in the dataset that references the snapshot.
 */
import fs from 'node:fs';
import path from 'node:path';
import { scanRepository } from '../src/index.js';

const argv = process.argv.slice(2);
const dropAt = argv.indexOf('--drop');
const drop = dropAt === -1 ? null : new RegExp(argv.splice(dropAt, 2)[1]);
const [repo, out, label] = argv;
if (!repo || !out) {
  console.error('usage: node bench/make-snapshot.js <repo> <out.json> [label] [--drop <regex>]');
  process.exit(2);
}

const scan = scanRepository(repo);
const files = {};
for (const f of scan.files) {
  const text = scan.reader.read(f.path);
  if (text === null || f.path.startsWith('bench/')) continue;
  files[f.path] = drop ? text.split('\n').filter((line) => !drop.test(line)).join('\n') : text;
}
fs.mkdirSync(path.dirname(out), { recursive: true });
fs.writeFileSync(out, `${JSON.stringify({ label: label ?? path.basename(path.resolve(repo)), fileCount: Object.keys(files).length, files }, null, 1)}\n`);
console.log(`wrote ${out}: ${Object.keys(files).length} files`);
