import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { test } from 'node:test';
import { scanRepository } from '../src/scanner.js';
import { compileContext } from '../src/compiler/compile.js';
import { diagnose } from '../src/doctor.js';
import { FAKE, fixture, makeRepo, treeDigest, trySymlink } from './helpers.js';

const paths = (scan) => scan.files.map((f) => f.path);

test('ignore rules: .gitignore, nested ignore, negation and .contextanvilignore are applied', () => {
  const repo = makeRepo({
    '.gitignore': '*.tmp\nbuild-output/\n!keep.tmp\n',
    '.contextanvilignore': 'generated/\n',
    'src/a.js': 'export const a = 1;\n',
    'src/scratch.tmp': 'x',
    'keep.tmp': 'x',
    'build-output/out.js': 'x',
    'generated/g.js': 'x',
    'pkg/.gitignore': 'local.js\n',
    'pkg/local.js': 'x',
    'pkg/real.js': 'x',
  });
  try {
    const scan = scanRepository(repo.root);
    assert.deepEqual(paths(scan).filter((p) => p.endsWith('.js') || p.endsWith('.tmp')), ['keep.tmp', 'pkg/real.js', 'src/a.js']);
    assert.ok(scan.stats.excluded.ignored >= 4);
    const raw = scanRepository(repo.root, { respectIgnore: false });
    assert.ok(paths(raw).includes('generated/g.js'));
  } finally {
    repo.cleanup();
  }
});

test('dependencies, build output and caches are never traversed', () => {
  const repo = makeRepo({
    'package.json': '{}',
    'node_modules/dep/index.js': 'x',
    'vendor/lib/a.php': 'x',
    'dist/bundle.js': 'x',
    '.next/cache/x.js': 'x',
    'storage/logs/laravel.log': 'x',
    'bootstrap/cache/services.php': 'x',
    'src/ok.js': 'x',
  });
  try {
    const scan = scanRepository(repo.root);
    assert.deepEqual(paths(scan), ['package.json', 'src/ok.js']);
    assert.ok(scan.stats.excluded.defaultDirs >= 6);
  } finally {
    repo.cleanup();
  }
});

test('sensitive files are listed by path only and their content never reaches any output', () => {
  const secret = FAKE.generic() + 'ENVVALUE';
  const repo = makeRepo({
    '.env': `DB_PASSWORD=${secret}\n`,
    'keys/server.pem': FAKE.privateKey(),
    '.env.example': 'DB_PASSWORD=\n',
    'AGENTS.md': '# Agents\n\nRun the tests with the project script before every change you make here.\n',
    'src/app.js': 'export {};\n',
  });
  try {
    const scan = scanRepository(repo.root);
    assert.deepEqual(scan.sensitiveFiles.map((s) => s.path), ['.env', 'keys/server.pem']);
    assert.ok(!paths(scan).includes('.env'));
    assert.ok(paths(scan).includes('.env.example'));
    const everything = JSON.stringify(scan) + compileContext(scan, 'database password config').rendered + JSON.stringify(diagnose(scan));
    assert.ok(!everything.includes(secret), 'the .env value must not appear anywhere');
    assert.ok(!everything.includes('MIIBOgIBAAJ'), 'private key material must not appear anywhere');
    assert.ok(diagnose(scan).findings.some((f) => f.id === 'sensitive-file-not-ignored'));
  } finally {
    repo.cleanup();
  }
});

test('a gitignored sensitive file is not reported as unprotected', () => {
  const repo = makeRepo({ '.gitignore': '.env\n', '.env': 'A=1\n', 'a.js': 'x' });
  try {
    const scan = scanRepository(repo.root);
    assert.deepEqual(scan.sensitiveFiles, []);
  } finally {
    repo.cleanup();
  }
});

test('oversized files are indexed but never read; oversized instructions are reported', () => {
  const repo = makeRepo({
    'big.js': 'a'.repeat(5000),
    'AGENTS.md': `# Agents\n\n${'rule '.repeat(2000)}\n`,
    'small.js': 'export const x = 1;\n',
  });
  try {
    const scan = scanRepository(repo.root, { maxFileBytes: 1000 });
    const big = scan.files.find((f) => f.path === 'big.js');
    assert.equal(big.oversized, true);
    assert.equal(scan.reader.read('big.js'), null);
    assert.equal(scan.reader.read('small.js'), 'export const x = 1;\n');
    assert.equal(scan.documents.length, 0);
    assert.ok(scan.diagnostics.some((d) => d.code === 'instruction-unreadable' && d.path === 'AGENTS.md'));
    assert.ok(diagnose(scan).findings.some((f) => f.id === 'instruction-unreadable'));
  } finally {
    repo.cleanup();
  }
});

test('traversal limits: max files truncates deterministically, shallow files first', () => {
  const files = {};
  for (let i = 0; i < 30; i++) files[`deep/nested/dir/f${String(i).padStart(2, '0')}.js`] = 'x';
  files['top.js'] = 'x';
  files['a/mid.js'] = 'x';
  const repo = makeRepo(files);
  try {
    const first = scanRepository(repo.root, { maxFiles: 5 });
    const second = scanRepository(repo.root, { maxFiles: 5 });
    assert.equal(first.files.length, 5);
    assert.equal(first.stats.truncated, true);
    assert.ok(first.diagnostics.some((d) => d.code === 'file-limit'));
    assert.ok(paths(first).includes('top.js') && paths(first).includes('a/mid.js'), 'breadth-first keeps shallow files');
    assert.deepEqual(paths(first), paths(second));
    const shallow = scanRepository(repo.root, { maxDepth: 1 });
    assert.ok(!paths(shallow).some((p) => p.startsWith('deep/nested')));
    assert.ok(shallow.diagnostics.some((d) => d.code === 'depth-limit'));
  } finally {
    repo.cleanup();
  }
});

test('invalid limits are rejected as usage errors', () => {
  assert.throws(() => scanRepository('.', { maxFiles: 0 }), { code: 'INVALID_LIMIT' });
  assert.throws(() => scanRepository('.', { maxDepth: 1.5 }), { code: 'INVALID_LIMIT' });
});

test('missing or non-directory roots fail with clear errors', () => {
  assert.throws(() => scanRepository(path.join(fixture('next-app'), 'nope')), { code: 'ROOT_NOT_FOUND' });
  assert.throws(() => scanRepository(path.join(fixture('next-app'), 'package.json')), { code: 'ROOT_NOT_DIRECTORY' });
});

test('symlinks: file and directory links that leave the root are not followed or read', (t) => {
  const repo = makeRepo({ 'src/a.js': 'export {};\n' });
  const outside = path.join(repo.base, 'outside');
  fs.mkdirSync(outside);
  const outsideSecret = 'OUTSIDE-' + FAKE.generic();
  fs.writeFileSync(path.join(outside, 'private.md'), `# Private\n\n${outsideSecret}\n`);
  try {
    const okFile = trySymlink(path.join(outside, 'private.md'), path.join(repo.root, 'AGENTS.md'), 'file');
    const okDir = trySymlink(outside, path.join(repo.root, 'linked-dir'), 'junction');
    if (!okFile && !okDir) return t.skip('symlinks are not permitted on this system');
    const scan = scanRepository(repo.root);
    assert.deepEqual(paths(scan), ['src/a.js']);
    assert.ok(scan.diagnostics.some((d) => d.code === 'symlink-escape'));
    assert.equal(scan.documents.length, 0);
    const out = JSON.stringify(scan) + compileContext(scan, 'private notes').rendered;
    assert.ok(!out.includes(outsideSecret));
  } finally {
    repo.cleanup();
  }
});

test('symlinks: a file link that stays inside the root is read through its target', (t) => {
  const repo = makeRepo({ 'AGENTS.md': '# Agents\n\nUse small functions and keep every module focused on one responsibility.\n' });
  try {
    if (!trySymlink('AGENTS.md', path.join(repo.root, 'CLAUDE.md'), 'file')) return t.skip('symlinks are not permitted on this system');
    const scan = scanRepository(repo.root);
    const claude = scan.documents.find((d) => d.path === 'CLAUDE.md');
    assert.equal(claude.symlinkTo, 'AGENTS.md');
    assert.equal(claude.sha256, scan.documents.find((d) => d.path === 'AGENTS.md').sha256);
    assert.ok(!diagnose(scan).findings.some((f) => f.id === 'duplicate-instructions'), 'a symlink is not a drifting duplicate');
  } finally {
    repo.cleanup();
  }
});

test('symlink cycles terminate', (t) => {
  const repo = makeRepo({ 'a/x.js': 'x' });
  try {
    if (!trySymlink(repo.root, path.join(repo.root, 'a', 'loop'), 'junction')) return t.skip('symlinks are not permitted on this system');
    const scan = scanRepository(repo.root);
    assert.deepEqual(paths(scan), ['a/x.js']);
  } finally {
    repo.cleanup();
  }
});

test('the reader only serves indexed, in-root paths (path traversal)', () => {
  const repo = makeRepo({ 'src/a.js': 'export {};\n' });
  fs.writeFileSync(path.join(repo.base, 'outside.txt'), 'TOP-SECRET-OUTSIDE');
  try {
    const { reader } = scanRepository(repo.root);
    for (const attempt of ['../outside.txt', '..\\outside.txt', 'src/../../outside.txt', path.join(repo.base, 'outside.txt'), '/etc/passwd', 'C:\\Windows\\win.ini', 'src/a.js\0.txt']) {
      assert.equal(reader.read(attempt), null, attempt);
      assert.equal(reader.exists(attempt), false, attempt);
    }
    assert.equal(reader.read('src/a.js'), 'export {};\n');
  } finally {
    repo.cleanup();
  }
});

test('traversal strings inside instruction files cannot make ContextAnvil touch files outside the root', () => {
  const repo = makeRepo({
    'AGENTS.md': '# Agents\n\nSee `../outside.txt` and `../../etc/hostname.conf` and `/etc/passwd.txt` for context on the whole setup.\n',
    'src/a.js': 'export {};\n',
  });
  fs.writeFileSync(path.join(repo.base, 'outside.txt'), 'TOP-SECRET-OUTSIDE');
  try {
    const scan = scanRepository(repo.root);
    const report = diagnose(scan);
    assert.ok(!report.findings.some((f) => f.id === 'missing-path-reference'), 'unsafe references are skipped, not probed');
    const out = JSON.stringify(report) + compileContext(scan, '../outside.txt').rendered;
    assert.ok(!out.includes('TOP-SECRET-OUTSIDE'));
  } finally {
    repo.cleanup();
  }
});

test('malformed manifests produce content-free diagnostics and do not abort the scan', () => {
  const scan = scanRepository(fixture('broken'));
  const codes = scan.diagnostics.filter((d) => d.code === 'malformed-json').map((d) => d.path).sort();
  assert.deepEqual(codes, ['composer.json', 'package.json', 'tsconfig.json']);
  for (const d of scan.diagnostics) assert.ok(!/not json at all|"test"|jest/.test(d.message), 'diagnostics must not quote file content');
  assert.ok(scan.facts.some((f) => f.id === 'manifest:package.json' && f.confidence === 'low'));
  assert.ok(scan.documents.some((d) => d.path === 'AGENTS.md'), 'other detectors still run');
});

test('binary files are skipped rather than decoded', () => {
  const repo = makeRepo({ 'data.js': Buffer.concat([Buffer.from('const x = '), Buffer.from([0, 1, 2, 0, 255]), Buffer.from(';')]), 'logo.png': Buffer.from([137, 80, 78, 71]) });
  try {
    const scan = scanRepository(repo.root);
    assert.equal(scan.reader.read('data.js'), null);
    assert.ok(!paths(scan).includes('logo.png'));
    assert.equal(scan.stats.excluded.binary, 1);
  } finally {
    repo.cleanup();
  }
});

test('analysis is read-only: the scanned tree is byte-for-byte unchanged', () => {
  for (const name of ['next-app', 'laravel-app', 'node-lib', 'broken']) {
    const before = treeDigest(fixture(name));
    const scan = scanRepository(fixture(name));
    compileContext(scan, 'update the main component');
    diagnose(scan);
    assert.equal(treeDigest(fixture(name)), before, name);
  }
});

test('output paths always use forward slashes and are sorted by code unit', () => {
  const scan = scanRepository(fixture('laravel-app'));
  assert.ok(scan.files.every((f) => !f.path.includes('\\')));
  const sorted = [...paths(scan)].sort((a, b) => (a < b ? -1 : a > b ? 1 : 0));
  assert.deepEqual(paths(scan), sorted);
});
