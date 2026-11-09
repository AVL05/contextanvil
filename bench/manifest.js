import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { snapshotRepository } from '../src/manifest/model.js';
import { readManifest, writeManifest } from '../src/manifest/storage.js';
import { generateScaleRepo } from './lib/materialize.js';
import { median } from './lib/metrics.js';

const self = fileURLToPath(import.meta.url);
const [mode, root, output] = process.argv.slice(2);
if (mode === 'create' || mode === 'update') {
  const start = performance.now();
  const previous = mode === 'update' ? readManifest(output) : undefined;
  const snapshot = snapshotRepository(root);
  const written = writeManifest(output, snapshot, previous);
  console.log(JSON.stringify({
    reads: snapshot.reads, bytesRead: snapshot.bytesRead, elapsedMs: performance.now() - start,
    peakRssKiB: process.resourceUsage().maxRSS, manifestBytes: Buffer.byteLength(snapshot.text), written,
  }));
} else {
  const repo = generateScaleRepo(Number(mode ?? 5000));
  try {
    const root = fs.realpathSync.native(repo.dir);
    const old = snapshotRepository(root);
    const dest = path.join(path.dirname(root), 'snapshot.json');
    const rows = [];
    for (const scenario of ['unchanged', 'edited']) {
      if (scenario === 'edited') fs.appendFileSync(path.join(root, 'package.json'), '\n');
      for (let run = 0; run < 4; run++) {
        for (const action of run % 2 ? ['update', 'create'] : ['create', 'update']) {
          if (action === 'update') writeManifest(dest, old);
          const row = JSON.parse(execFileSync(process.execPath, [self, action, root, dest], { encoding: 'utf8' }));
          assert.equal(row.written, action === 'create' || scenario === 'edited');
          fs.unlinkSync(dest);
          rows.push({ action, scenario, ...row });
        }
      }
    }
    const summary = [];
    for (const scenario of ['unchanged', 'edited']) {
      for (const action of ['create', 'update']) {
        const runs = rows.filter((r) => r.action === action && r.scenario === scenario);
        summary.push({ scenario, action, ...Object.fromEntries(
          ['reads', 'bytesRead', 'elapsedMs', 'peakRssKiB', 'manifestBytes'].map((metric) => [
            metric, median(runs.map((r) => r[metric])),
          ]),
        ) });
      }
    }
    console.log(JSON.stringify({ node: process.version, platform: process.platform, summary, rows }, null, 2));
  } finally {
    repo.cleanup();
  }
}
