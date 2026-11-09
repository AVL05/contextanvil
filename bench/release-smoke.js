import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fixture, treeDigest } from '../test/helpers.js';

const installed = path.resolve(process.argv[2]);
const pkg = JSON.parse(fs.readFileSync(new URL('../package.json', import.meta.url)));
const bin = path.join(installed, 'node_modules', pkg.name, pkg.bin.contextanvil);
const base = fs.realpathSync.native(fs.mkdtempSync(path.join(os.tmpdir(), 'contextanvil-rc-')));
const root = path.join(base, 'repo');
const manifest = path.join(base, 'snapshot.json');

function run(args, expected = 0) {
  const result = spawnSync(process.execPath, args, { cwd: installed, encoding: 'utf8', timeout: 30000 });
  assert.ifError(result.error);
  assert.equal(result.status, expected, args.slice(1).join(' ') + '\n' + result.stderr + result.stdout);
  return result.stdout;
}
const cli = (...args) => run([bin, ...args]);
const json = (...args) => JSON.parse(cli(...args, '--json'));

try {
  fs.cpSync(fixture('next-app'), root, { recursive: true });
  const original = treeDigest(root);
  assert.equal(cli('--version').trim(), pkg.version);
  assert.match(cli('--help'), /manifest <action>/);
  assert.ok(json('scan', root).facts.some((fact) => fact.id === 'framework:next-js'));
  assert.equal(json('doctor', root, '--fail-on', 'never').schemaVersion, 1);
  const pack = json('context', 'Update the navigation component', root, '--budget', '8kb');
  assert.ok(pack.files.some((file) => file.path === 'components/Navigation.tsx'));
  assert.ok(pack.budget.usedBytes <= 8192);
  assert.equal(json('manifest', 'create', root, '--output', manifest).written, true);
  assert.equal(json('manifest', 'verify', root, '--manifest', manifest).diff.identical, true);
  assert.equal(json('manifest', 'update', root, '--manifest', manifest).written, false);
  assert.equal(treeDigest(root), original);

  fs.writeFileSync(path.join(root, 'release-smoke.js'), 'export const smoke = true;\n');
  const drift = JSON.parse(run([bin, 'manifest', 'verify', root, '--manifest', manifest, '--json'], 1));
  assert.deepEqual(drift.diff.files.added, ['release-smoke.js']);
  assert.equal(json('manifest', 'diff', root, '--manifest', manifest).diff.identical, false);
  assert.equal(json('manifest', 'update', root, '--manifest', manifest).written, true);
  assert.equal(json('manifest', 'verify', root, '--manifest', manifest).diff.identical, true);
  const usage = JSON.parse(run([bin, 'manifest', 'verify', root, '--bogus', '--json'], 2));
  assert.equal(usage.error.code, 'ERR_PARSE_ARGS_UNKNOWN_OPTION');
  const overwrite = JSON.parse(run([bin, 'manifest', 'create', root, '--output', manifest, '--json'], 3));
  assert.equal(overwrite.error.code, 'MANIFEST_STORAGE');
  const malformed = path.join(base, 'malformed.json');
  fs.writeFileSync(malformed, '{');
  const invalid = JSON.parse(run([bin, 'manifest', 'verify', root, '--manifest', malformed, '--json'], 3));
  assert.equal(invalid.error.code, 'INVALID_MANIFEST');
  run(['--input-type=module', '-e', "import assert from 'node:assert/strict'; import { scanRepository, compileContext, diagnose, VERSION } from 'contextanvil'; assert.equal(typeof scanRepository, 'function'); assert.equal(typeof compileContext, 'function'); assert.equal(typeof diagnose, 'function'); assert.equal(VERSION, " + JSON.stringify(pkg.version) + ");"]);
  console.log('Installed CLI, manifest lifecycle and ESM exports passed for ' + pkg.version);
} finally {
  fs.rmSync(base, { recursive: true, force: true });
}
