import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { test } from 'node:test';
import { diffManifest, parseManifest, serializeManifest, snapshotRepository } from '../src/manifest/model.js';
import { readManifest, writeManifest } from '../src/manifest/storage.js';
import { BIN, FAKE, makeRepo, treeDigest, trySymlink } from './helpers.js';

function setup(t, files) {
  const repo = makeRepo(files);
  t.after(repo.cleanup);
  return { ...repo, output: path.join(fs.realpathSync.native(repo.base), 'snapshot.json') };
}

function resigned(manifest) {
  const { integrity, ...body } = manifest;
  const sha256 = crypto.createHash('sha256').update(serializeManifest(body)).digest('hex');
  return serializeManifest({ ...body, integrity: { sha256 } });
}

test('canonical snapshots omit source text, sensitive paths and machine roots', (t) => {
  const files = {
    'src/task.js': 'export const item = 1;\n',
    'package.json': JSON.stringify({ scripts: { test: 'echo ' + FAKE.aws() } }),
    '.env': 'PASSWORD=private',
    'AGENTS.md': '# Instructions\nA private project sentence.\n',
  };
  const a = setup(t, files);
  const b = setup(t, files);
  const first = snapshotRepository(a.root);
  assert.equal(first.manifest.scan.complete, true);
  assert.equal(first.text, snapshotRepository(b.root).text);
  assert.deepEqual(parseManifest(first.text), first.manifest);
  assert.ok(first.manifest.files.some((file) => file.path === 'src/task.js'));
  assert.ok(first.manifest.facts.some((fact) => fact.evidence.some((e) => e.path === 'AGENTS.md')));
  for (const privateText of ['private project sentence', FAKE.aws(), '.env', a.root]) {
    assert.ok(!first.text.includes(privateText));
  }
});

test('schema, version, integrity and hostile JSON are rejected', (t) => {
  const { root } = setup(t, { 'task.js': 'export const task = 1;' });
  const { manifest, text } = snapshotRepository(root);
  assert.throws(() => parseManifest('{'), /valid JSON/);
  assert.throws(() => parseManifest('['.repeat(50_000)), /nesting/);
  assert.throws(() => parseManifest(' '.repeat(16 * 1024 * 1024 + 1)), /16 MiB/);
  assert.throws(() => parseManifest(text.replace('"schemaVersion": 1', '"schemaVersion": 999')), /Unsupported/);
  assert.throws(() => parseManifest(text.replace(/"sha256": "[a-f0-9]{64}"\n  }/, '"sha256": "' + '0'.repeat(64) + '"\n  }')), /integrity/);
  assert.throws(() => parseManifest(text.replace('"format":', '"format": "duplicate",\n  "format":')), /canonical/);
  assert.throws(() => parseManifest(resigned({ ...manifest, scan: { ...manifest.scan, ['__proto__']: {} } })), /structure/);
  for (const hostile of ['../task.js', 'src/../task.js', 'a\\b.js', 'C:/task.js', '.git/config', 'bad\u202efile']) {
    const forged = { ...manifest, files: [{ ...manifest.files[0], path: hostile }] };
    assert.throws(() => parseManifest(resigned(forged)), /structure/);
  }
});

test('update equals fresh creation after same-size edits, add, remove, rename, ignore and config changes', (t) => {
  const repo = setup(t, { 'a.js': 'alpha', 'b.js': 'bravo', 'old.js': 'remove', 'AGENTS.md': '# Rules\nKeep tests.' });
  const cli = (...args) => spawnSync(process.execPath, [BIN, 'manifest', ...args], { encoding: 'utf8' });
  const first = cli('create', repo.root, '--output', repo.output, '--json');
  assert.equal(first.status, 0, first.stderr || first.stdout);
  const unchanged = cli('update', repo.root, '--manifest', repo.output, '--json');
  assert.equal(unchanged.status, 0, unchanged.stderr || unchanged.stdout);
  assert.equal(JSON.parse(unchanged.stdout).written, false);
  const original = readManifest(repo.output);
  const a = path.join(repo.root, 'a.js');
  const stamp = fs.statSync(a).mtime;
  fs.writeFileSync(a, 'omega');
  fs.utimesSync(a, stamp, stamp);
  fs.renameSync(path.join(repo.root, 'b.js'), path.join(repo.root, 'renamed.js'));
  fs.unlinkSync(path.join(repo.root, 'old.js'));
  fs.writeFileSync(path.join(repo.root, '.gitignore'), 'ignored.js\n');
  fs.writeFileSync(path.join(repo.root, 'ignored.js'), 'ignored');
  fs.writeFileSync(path.join(repo.root, 'package.json'), '{"dependencies":{"react":"^19.0.0"}}');
  fs.writeFileSync(path.join(repo.root, 'AGENTS.md'), '# Rules\nAdd coverage.');
  const tree = treeDigest(repo.root);
  const drift = cli('verify', repo.root, '--manifest', repo.output, '--json');
  assert.equal(drift.status, 1, drift.stderr || drift.stdout);
  assert.deepEqual(JSON.parse(drift.stdout).diff.files, {
    added: ['.gitignore', 'package.json', 'renamed.js'],
    removed: ['b.js', 'old.js'],
    changed: ['AGENTS.md', 'a.js'],
  });
  assert.equal(readManifest(repo.output).text, original.text);
  const next = cli('update', repo.root, '--manifest', repo.output, '--no-gitignore', '--json');
  assert.equal(next.status, 0, next.stderr || next.stdout);
  assert.equal(JSON.parse(next.stdout).strategy, 'full-reconstruction');
  assert.equal(readManifest(repo.output).text, snapshotRepository(repo.root, { respectIgnore: false }).text);
  assert.equal(treeDigest(repo.root), tree);
});

test('atomic create, injected publish failure and concurrent replacement preserve complete files', (t) => {
  const repo = setup(t, { 'file.js': 'first' });
  const first = snapshotRepository(repo.root);
  assert.equal(writeManifest(repo.output, first), true);
  const original = readManifest(repo.output);
  assert.throws(() => writeManifest(repo.output, first), /already exists/);
  if (process.platform !== 'win32') assert.equal(fs.statSync(repo.output).mode & 0o777, 0o600);
  fs.writeFileSync(path.join(repo.root, 'file.js'), 'second');
  const next = snapshotRepository(repo.root);
  assert.throws(() => writeManifest(repo.output, next, original, {
    replace() { throw new Error('simulated publish failure'); },
  }), /Could not publish/);
  assert.equal(readManifest(repo.output).text, original.text);
  assert.deepEqual(fs.readdirSync(repo.base).sort(), ['repo', 'snapshot.json']);
  assert.equal(writeManifest(repo.output, next, original), true);
  assert.throws(() => writeManifest(repo.output, first, original), /changed since/);
  const lock = path.join(repo.base, '.snapshot.json.contextanvil-lock');
  fs.writeFileSync(lock, '');
  assert.throws(() => writeManifest(repo.output, first, readManifest(repo.output)), /lock already exists/);
  assert.ok(fs.existsSync(lock));
  assert.equal(readManifest(repo.output).text, next.text);
  assert.throws(() => writeManifest(path.join(repo.root, 'snapshot.json'), next), /outside/);
  assert.throws(() => writeManifest(path.join(repo.base, 'NUL.json'), next), /Unsafe/);
});

test('partial scans expose warnings and cannot overwrite a complete snapshot', (t) => {
  const repo = setup(t, { 'a.js': 'abc', 'b.js': 'xyz' });
  const full = snapshotRepository(repo.root);
  writeManifest(repo.output, full);
  fs.writeFileSync(path.join(repo.root, '.gitignore'), '# comment\n');
  for (const limits of [{ maxFiles: 1 }, { maxFileBytes: 1 }, { maxTotalReadBytes: 4 }, { maxIgnoreFileBytes: 1 }]) {
    const partial = snapshotRepository(repo.root, limits);
    assert.equal(partial.manifest.scan.complete, false);
    assert.ok(partial.manifest.scan.warnings.length);
    assert.equal(diffManifest(full.manifest, partial.manifest).complete, false);
    assert.throws(() => writeManifest(repo.output, partial, readManifest(repo.output)), /Incomplete/);
    assert.equal(readManifest(repo.output).text, full.text);
  }
});

test('manifest paths refuse symlinks and source aliases cannot hash credentials', (t) => {
  const repo = setup(t, { '.env': 'secret', 'source.js': 'hello' });
  writeManifest(repo.output, snapshotRepository(repo.root));
  const alias = path.join(repo.base, 'alias.json');
  if (!trySymlink(repo.output, alias, 'file')) return t.skip('symlinks unavailable');
  assert.throws(() => readManifest(alias), /regular file/);
  assert.throws(() => writeManifest(alias, snapshotRepository(repo.root)), /already exists/);
  assert.ok(trySymlink(path.join(repo.root, '.env'), path.join(repo.root, 'alias.js'), 'file'));
  const { manifest } = snapshotRepository(repo.root);
  assert.ok(!manifest.files.some((file) => file.path === 'alias.js' || file.path === '.env'));
});
