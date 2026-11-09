import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import path from 'node:path';
import { test } from 'node:test';
import { run } from '../src/cli/index.js';
import { BIN, REPO_ROOT, collector, fixture, makeRepo } from './helpers.js';

/** Run the real executable in a child process, as a user would. */
function cli(args, options = {}) {
  const r = spawnSync(process.execPath, [BIN, ...args], { encoding: 'utf8', cwd: options.cwd ?? REPO_ROOT, timeout: 30000 });
  return { code: r.status, out: r.stdout, err: r.stderr };
}

test('--version prints the package version', () => {
  const pkg = JSON.parse(fs_read(path.join(REPO_ROOT, 'package.json')));
  for (const flag of ['--version', '-v']) {
    const r = cli([flag]);
    assert.equal(r.code, 0);
    assert.equal(r.out.trim(), pkg.version);
  }
});

test('--help and per-command help exit 0 and document the commands', () => {
  const main = cli(['--help']);
  assert.equal(main.code, 0);
  for (const word of ['scan', 'context', 'doctor', '--version', 'Exit codes']) assert.match(main.out, new RegExp(word));
  for (const [cmd, flag] of [['scan', '--json'], ['context', '--budget'], ['doctor', '--fail-on']]) {
    const r = cli([cmd, '--help']);
    assert.equal(r.code, 0);
    assert.match(r.out, new RegExp(flag));
  }
});

test('no arguments shows help and exits 2 (usage error)', () => {
  const r = cli([]);
  assert.equal(r.code, 2);
  assert.match(r.out, /Usage:/);
});

test('usage errors exit 2 with a message on stderr and nothing on stdout', () => {
  const cases = [
    ['frobnicate'],
    ['scan', '--bogus'],
    ['context'],
    ['context', 'task', 'a', 'b'],
    ['scan', 'a', 'b'],
    ['scan', '--max-files', 'abc'],
    ['scan', '--max-files', '0', '.'],
    ['context', 'x', '--budget', 'lots'],
    ['doctor', '--fail-on', 'sometimes'],
  ];
  for (const args of cases) {
    const r = cli(args);
    assert.equal(r.code, 2, args.join(' '));
    assert.equal(r.out, '', args.join(' '));
    assert.match(r.err, /^contextanvil: /, args.join(' '));
  }
});

test('runtime errors exit 3', () => {
  const missing = cli(['scan', path.join(fixture('next-app'), 'does-not-exist')]);
  assert.equal(missing.code, 3);
  assert.match(missing.err, /does not exist/);
  assert.equal(cli(['scan', path.join(fixture('next-app'), 'package.json')]).code, 3);
});

test('scan prints a report and succeeds; --json is valid, complete and content-free', () => {
  const text = cli(['scan', fixture('next-app')]);
  assert.equal(text.code, 0);
  assert.match(text.out, /Next\.js \^14\.2\.3/);
  assert.match(text.out, /package\.json:13/);

  const json = cli(['scan', fixture('next-app'), '--json']);
  assert.equal(json.code, 0);
  const scan = JSON.parse(json.out);
  assert.equal(scan.schemaVersion, 1);
  assert.ok(scan.facts.length > 10);
  assert.equal(scan.files, undefined, 'file list only with --files');
  assert.equal(scan.documents[0].text, undefined, 'instruction text is not dumped');
  assert.ok(JSON.parse(cli(['scan', fixture('next-app'), '--json', '--files']).out).files.length > 5);
});

test('context prints Markdown or JSON and honours the budget flag', () => {
  const md = cli(['context', 'Update the navigation component', fixture('next-app')]);
  assert.equal(md.code, 0);
  assert.match(md.out, /components\/Navigation\.tsx/);
  const json = cli(['context', 'Update the navigation component', fixture('next-app'), '--json', '--budget', '2500b']);
  assert.equal(json.code, 0);
  const pack = JSON.parse(json.out);
  assert.ok(Buffer.byteLength(pack.rendered) <= 2500);
  assert.equal(pack.files[0].path, 'components/Navigation.tsx');
  assert.equal(cli(['context', 'x thing', fixture('next-app'), '--budget', '50b']).code, 2, 'budget too small is a usage error');
});

test('context defaults the path to the working directory', () => {
  const r = cli(['context', 'format the title', '.'], { cwd: fixture('next-app') });
  assert.equal(r.code, 0);
  assert.match(r.out, /lib\/format\.ts/);
});

test('--max-content-files bounds content reading deterministically and says so', () => {
  const run = () => cli(['context', 'Update the navigation component', fixture('next-app'), '--max-content-files', '3', '--json']);
  const a = run();
  assert.equal(a.code, 0, a.err);
  const pack = JSON.parse(a.out);
  assert.ok(pack.omissions.some((o) => o.kind === 'content-limit'), 'the limit is reported as an omission');
  assert.equal(a.out, run().out, 'same limit, same bytes');
  assert.equal(cli(['context', 'navigation', fixture('next-app'), '--max-content-files', '0']).code, 0, '0 means match by path only');
  assert.equal(cli(['context', 'x thing', fixture('next-app'), '--max-content-files', 'many']).code, 2);
});

test('doctor exit codes follow --fail-on', () => {
  assert.equal(cli(['doctor', fixture('next-app')]).code, 1, 'warnings fail by default');
  assert.equal(cli(['doctor', fixture('next-app'), '--fail-on', 'error']).code, 0);
  assert.equal(cli(['doctor', fixture('next-app'), '--fail-on', 'never']).code, 0);
  const json = JSON.parse(cli(['doctor', fixture('next-app'), '--json', '--fail-on', 'never']).out);
  assert.deepEqual(json.summary, { error: 0, warning: 3, info: 2 });
  assert.match(cli(['doctor', fixture('next-app')]).out, /CONTRADICTIONS/);
});

test('doctor passes (exit 0) on a healthy repository', () => {
  const r = cli(['doctor', REPO_ROOT]);
  assert.equal(r.code, 0, r.out);
});

test('paths containing spaces work end to end', () => {
  const repo = makeRepo({ 'package.json': '{"name":"spaced"}', 'AGENTS.md': '# A\n\nKeep it simple and write tests for every change you make in this repository.\n', 'src/widget.js': 'export function widget() {}\n' });
  try {
    assert.match(repo.base, / /);
    const r = cli(['context', 'fix the widget', repo.root]);
    assert.equal(r.code, 0, r.err);
    assert.match(r.out, /src\/widget\.js/);
  } finally {
    repo.cleanup();
  }
});

test('run() is usable in-process with injected streams and never calls process.exit', async () => {
  const stdout = collector();
  const stderr = collector();
  const code = await run(['scan', fixture('node-lib'), '--json'], { stdout, stderr, cwd: REPO_ROOT });
  assert.equal(code, 0);
  assert.equal(stderr.text, '');
  assert.equal(JSON.parse(stdout.text).root, fixture('node-lib'));
  const bad = collector();
  assert.equal(await run(['nope'], { stdout: collector(), stderr: bad }), 2);
  assert.match(bad.text, /Unknown command "nope"/);
});

test('relative paths resolve against the provided working directory', async () => {
  const stdout = collector();
  const code = await run(['scan', 'test/fixtures/laravel-app', '--json'], { stdout, stderr: collector(), cwd: REPO_ROOT });
  assert.equal(code, 0);
  assert.ok(JSON.parse(stdout.text).facts.some((f) => f.id === 'framework:laravel'));
});

test('output is ASCII-only so legacy Windows consoles render it correctly', () => {
  for (const args of [['scan', fixture('next-app')], ['doctor', fixture('next-app'), '--fail-on', 'never'], ['context', 'navigation', fixture('next-app')], ['--help']]) {
    const r = cli(args);
    assert.ok(/^[\x09\x0a\x0d\x20-\x7e]*$/.test(r.out), `non-ASCII output from ${args[0]}`);
  }
});

import fs from 'node:fs';
function fs_read(p) {
  return fs.readFileSync(p, 'utf8');
}
