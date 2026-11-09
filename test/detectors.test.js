import assert from 'node:assert/strict';
import { test } from 'node:test';
import { scanRepository } from '../src/scanner.js';
import { fixture, makeRepo } from './helpers.js';

const byId = (scan, id) => scan.facts.find((f) => f.id === id);
const ids = (scan, kind) => scan.facts.filter((f) => f.kind === kind).map((f) => f.id);

test('Next.js + React + TypeScript project is detected with evidence', () => {
  const scan = scanRepository(fixture('next-app'));
  const next = byId(scan, 'framework:next-js');
  assert.ok(next, 'Next.js fact');
  assert.equal(next.data.router, 'app');
  assert.equal(next.confidence, 'high');
  assert.equal(next.status, 'observed');
  assert.equal(next.source, 'package.json');
  assert.equal(next.evidence[0].line, 13);
  assert.ok(next.evidence.some((e) => e.path === 'next.config.mjs'), 'corroborated by next.config');
  assert.ok(next.evidence.some((e) => e.path === 'app/layout.tsx' || e.path === 'app/page.tsx'));
  assert.ok(byId(scan, 'framework:react'));
  assert.ok(byId(scan, 'tool:typescript-compiler'));
  assert.deepEqual(ids(scan, 'test-framework').sort(), ['test-framework:jest', 'test-framework:react-testing-library']);
  assert.equal(byId(scan, 'language:typescript').data.files, 7);
  assert.equal(byId(scan, 'package-manager:npm').source, 'package-lock.json');
  assert.deepEqual(ids(scan, 'entrypoint'), ['entrypoint:app/layout.tsx', 'entrypoint:app/page.tsx']);
});

test('freshness digests identify the source file content', () => {
  const scan = scanRepository(fixture('next-app'));
  const next = byId(scan, 'framework:next-js');
  assert.match(next.freshness.sha256, /^[0-9a-f]{16}$/);
  assert.ok(next.freshness.bytes > 0);
  const doc = scan.documents.find((d) => d.path === 'CLAUDE.md');
  assert.match(doc.sha256, /^[0-9a-f]{16}$/);
});

test('scripts are reported but never executed', () => {
  const repo = makeRepo({
    'package.json': JSON.stringify({ scripts: { test: 'node -e "require(\'fs\').writeFileSync(\'PWNED\',\'1\')"', postinstall: 'node pwn.js' } }),
    'pwn.js': "require('fs').writeFileSync('PWNED', '1')",
  });
  try {
    const scan = scanRepository(repo.root);
    assert.equal(byId(scan, 'script:test').data.role, 'test');
    assert.equal(byId(scan, 'script:postinstall').data.runsOnInstall, true);
    assert.equal(scan.files.some((f) => f.path === 'PWNED'), false);
  } finally {
    repo.cleanup();
  }
});

test('Laravel project: framework, tests, PSR-4 and framework entry points', () => {
  const scan = scanRepository(fixture('laravel-app'));
  const laravel = byId(scan, 'framework:laravel');
  assert.equal(laravel.data.package, 'laravel/framework');
  assert.ok(laravel.evidence.some((e) => e.path === 'artisan'));
  assert.ok(byId(scan, 'test-framework:phpunit'));
  assert.ok(byId(scan, 'tool:laravel-pint'));
  assert.equal(byId(scan, 'convention:psr4:App\\').data.directories[0], 'app/');
  assert.ok(ids(scan, 'entrypoint').includes('entrypoint:public/index.php'));
  assert.ok(ids(scan, 'entrypoint').includes('entrypoint:routes/web.php'));
  assert.equal(byId(scan, 'language:blade').data.files, 1);
  assert.ok(byId(scan, 'script:composer:test'));
  const controllers = byId(scan, 'source-dir:app/Http/Controllers');
  assert.match(controllers.claim, /Laravel controllers/);
  assert.equal(controllers.status, 'inferred', 'role comes from a framework convention, not from the name alone');
});

test('directory names alone never produce a role', () => {
  const repo = makeRepo({
    'app/Http/Controllers/A.php': '<?php class A {}',
    'app/Http/Controllers/B.php': '<?php class B {}',
    'components/a.js': 'x',
    'components/b.js': 'x',
  });
  try {
    const scan = scanRepository(repo.root);
    for (const f of scan.facts.filter((x) => x.kind === 'source-dir')) assert.equal(f.data.role, null, f.id);
  } finally {
    repo.cleanup();
  }
});

test('Node library: ESM, built-in test runner, bin and main entry points', () => {
  const scan = scanRepository(fixture('node-lib'));
  assert.equal(byId(scan, 'convention:module-system').data.moduleSystem, 'module');
  assert.ok(byId(scan, 'test-framework:node-test'));
  assert.deepEqual(ids(scan, 'entrypoint').sort(), ['entrypoint:bin/cli.js', 'entrypoint:src/index.js']);
  assert.match(byId(scan, 'source-dir:bin').claim, /CLI entry points/);
  assert.equal(byId(scan, 'convention:node-engines').data.node, '>=20');
});

test('a manifest entry that points at a missing file is diagnosed; build outputs are not', () => {
  const repo = makeRepo({ 'package.json': JSON.stringify({ main: 'src/gone.js', bin: { x: 'dist/cli.js' } }) });
  try {
    const scan = scanRepository(repo.root);
    const missing = scan.diagnostics.filter((d) => d.code === 'entrypoint-missing');
    assert.equal(missing.length, 1);
    assert.match(missing[0].message, /src\/gone\.js/);
  } finally {
    repo.cleanup();
  }
});

test('conflicting lockfiles are reported as a diagnostic, not guessed', () => {
  const repo = makeRepo({ 'package.json': '{}', 'package-lock.json': '{}', 'yarn.lock': '' });
  try {
    const scan = scanRepository(repo.root);
    assert.ok(scan.diagnostics.some((d) => d.code === 'multiple-lockfiles'));
    assert.deepEqual(ids(scan, 'package-manager').sort(), ['package-manager:npm', 'package-manager:yarn']);
  } finally {
    repo.cleanup();
  }
});

test('conventions: EditorConfig, Prettier JSON and tsconfig with comments are parsed statically', () => {
  const scan = scanRepository(fixture('next-app'));
  assert.deepEqual(byId(scan, 'convention:editorconfig').data.values, { indent_style: 'space', indent_size: '2', end_of_line: 'lf' });
  assert.deepEqual(byId(scan, 'convention:prettier').data.options, { semi: false, singleQuote: true, tabWidth: 2 });
  assert.equal(byId(scan, 'convention:typescript').data.strict, true);
});

test('JavaScript config files are never executed or evaluated', () => {
  const repo = makeRepo({
    'package.json': '{}',
    'prettier.config.js': "require('fs').writeFileSync('PWNED','1'); module.exports = { semi: true };",
    'src/a.js': 'x',
  });
  try {
    const scan = scanRepository(repo.root);
    assert.ok(scan.facts.some((f) => f.id === 'config:prettier.config.js'));
    assert.equal(byId(scan, 'convention:prettier'), undefined);
    assert.equal(scan.files.some((f) => f.path === 'PWNED'), false);
  } finally {
    repo.cleanup();
  }
});

test('inferred conventions carry counts and the inferred status', () => {
  const files = {};
  for (const n of ['user-list', 'user-detail', 'nav-bar', 'side-menu', 'page-header', 'footer-links']) files[`src/${n}.js`] = 'export {};';
  files['src/user-list.test.js'] = 'x';
  files['src/nav-bar.test.js'] = 'x';
  const repo = makeRepo(files);
  try {
    const scan = scanRepository(repo.root);
    const naming = byId(scan, 'convention:file-naming');
    assert.equal(naming.status, 'inferred');
    assert.equal(naming.data.style, 'kebab-case');
    assert.equal(byId(scan, 'convention:test-layout').data.testFiles, 2);
  } finally {
    repo.cleanup();
  }
});

test('instruction files: multiple tools, nested scope, headings and hidden characters', () => {
  const repo = makeRepo({
    'AGENTS.md': '# Root\n\n## Testing\n\nRun the full suite before committing, always, without exception here.\n',
    'packages/api/AGENTS.md': '# API\n\nKeep handlers small and validate every request body before using it anywhere.\n',
    '.github/copilot-instructions.md': '# Copilot\n\nPrefer small pure functions and descriptive names across the entire codebase.\n',
    'CLAUDE.md': '# Claude\n\nHidden​ text‮ here and some more sentences to exceed the short threshold easily.\n',
  });
  try {
    const scan = scanRepository(repo.root);
    assert.deepEqual(scan.documents.map((d) => d.path), ['.github/copilot-instructions.md', 'AGENTS.md', 'CLAUDE.md', 'packages/api/AGENTS.md']);
    assert.equal(scan.documents.find((d) => d.path === 'packages/api/AGENTS.md').scope, 'packages/api');
    assert.equal(scan.documents.find((d) => d.path === '.github/copilot-instructions.md').scope, '');
    assert.deepEqual(scan.documents.find((d) => d.path === 'AGENTS.md').headings.map((h) => h.title), ['Root', 'Testing']);
    const claude = scan.documents.find((d) => d.path === 'CLAUDE.md');
    assert.equal(claude.hiddenCharacters.length, 2);
    assert.ok(claude.text.includes('<U+200B>'), 'hidden characters are made visible');
    assert.ok(!claude.text.includes('​'));
  } finally {
    repo.cleanup();
  }
});
