#!/usr/bin/env node
/**
 * Prints a SHA-256 digest of ContextAnvil's complete output (scan, context pack,
 * doctor report) for every benchmark dataset. CI runs this on every operating
 * system and Node.js version and fails if the digests differ: it is the
 * cross-platform determinism check.
 *
 *   node bench/digest.js            # JSON object of digests
 *   node bench/digest.js --verbose  # also prints the digest of each task
 */
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { compileContext, diagnose, scanRepository } from '../src/index.js';
import { materialize } from './lib/materialize.js';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const verbose = process.argv.includes('--verbose');
const sha = (s) => crypto.createHash('sha256').update(s).digest('hex').slice(0, 16);
const data = JSON.parse(fs.readFileSync(path.join(HERE, 'datasets', 'tasks.json'), 'utf8'));

const out = {};
const all = [];
for (const ds of data.datasets) {
  const repo = materialize(HERE, ds.source);
  try {
    // The only legitimately machine-specific text is the temporary directory; mask it in both slash styles.
    const mask = (value) => JSON.stringify(value)
      .split(repo.dir.replace(/\\/g, '\\\\')).join('<root>')
      .split(repo.dir.replace(/\\/g, '/')).join('<root>');
    const scan = scanRepository(repo.dir);
    const parts = [mask(scan), mask(diagnose(scan))];
    for (const t of ds.tasks) {
      const pack = mask(compileContext(scan, t.task));
      if (verbose) console.error(`${ds.id}/${t.id}: ${sha(pack)}`);
      parts.push(pack);
    }
    out[ds.id] = sha(parts.join('\n'));
    all.push(out[ds.id]);
  } finally {
    repo.cleanup();
  }
}
out.combined = sha(all.join('|'));
console.log(JSON.stringify(out, null, 2));
