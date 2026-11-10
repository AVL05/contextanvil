#!/usr/bin/env node
// Offline integrity check for the sealed Doctor holdout reservation.
// It reads the reservation, its documented digest and the disclosed benchmark files. It never reads
// repository content, runs Doctor or uses the network.
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import {
  HOLDOUT_DIR, PROJECT_DIR, instructionPaths, isMain, lfDigest, loadExpected, loadIdentities, loadInputs, readText, ToolError,
} from './lib.mjs';

const HEX40 = /^[0-9a-f]{40}$/;
const MODES = new Set(['100644', '100755', '120000']);

function walk(dir, out = []) {
  if (!existsSync(dir)) return out;
  for (const name of readdirSync(dir)) {
    const full = join(dir, name);
    if (statSync(full).isDirectory()) walk(full, out);
    else out.push(full);
  }
  return out;
}

export function verifyInputs({ projectDir = PROJECT_DIR, holdoutDir = HOLDOUT_DIR } = {}) {
  const checks = [];
  const check = (name, ok, detail = '') => checks.push({ name, ok: Boolean(ok), detail });
  const inputsPath = join(holdoutDir, 'inputs.json');
  const raw = readText(inputsPath);
  const inputs = loadInputs(inputsPath);
  const digest = lfDigest(raw);
  const documented = readText(join(holdoutDir, 'README.md')).match(/`([0-9a-f]{64})`/)?.[1];
  check('manifest digest matches the documented digest', documented === digest, `computed ${digest}, documented ${documented}`);

  const EXPECTED = loadExpected(join(holdoutDir, 'identities.json'));
  check('repository count', inputs.length === EXPECTED.repositories, `${inputs.length}`);
  const instructions = instructionPaths(inputs);
  check('instruction path count', instructions.length === EXPECTED.instructionPaths, `${instructions.length}`);
  check('repositories are unique', new Set(inputs.map((r) => r.repository)).size === inputs.length);

  const malformed = [];
  for (const repo of inputs) {
    if (!HEX40.test(repo.commit)) malformed.push(`${repo.repository} commit`);
    const seen = new Set();
    for (const p of repo.paths) {
      if (!HEX40.test(p.sha) || !MODES.has(p.mode) || seen.has(p.path) || p.path.startsWith('/') || p.path.includes('..')) {
        malformed.push(`${repo.repository}:${p.path}`);
      }
      seen.add(p.path);
    }
  }
  check('commits, blob ids, modes and paths are well formed', malformed.length === 0, malformed.join(', '));

  // The tree field of the reservation equals the commit id. A Git tree id can never equal a commit id,
  // so the real tree ids live in identities.json. This is recorded, not corrected, to keep the digest.
  const aliased = inputs.filter((r) => r.tree === r.commit).length;
  check('reservation tree field is a commit alias (recorded in identities.json)', aliased === inputs.length || aliased === 0,
    `${aliased} of ${inputs.length} entries repeat the commit id`);
  const identities = loadIdentities(join(holdoutDir, 'identities.json'));
  const mismatched = inputs.filter((r) => {
    const id = identities.find((i) => i.repository === r.repository);
    return !id || id.commit !== r.commit || !HEX40.test(id.tree) || id.tree === r.commit;
  });
  check('identities.json agrees with the reservation and holds distinct tree ids', mismatched.length === 0,
    mismatched.map((r) => r.repository).join(', '));

  const names = new Set(inputs.map((r) => r.repository.toLowerCase()));
  const commits = new Set(inputs.map((r) => r.commit));
  const corpus = JSON.parse(readText(join(projectDir, 'bench', 'doctor', 'corpus.json')));
  const overlap = corpus.repositories.filter((r) => names.has(String(r.repo).toLowerCase())).map((r) => r.repo);
  check('no overlap with the disclosed historical corpus', overlap.length === 0, overlap.join(', '));

  // No Doctor output or labels may reference the reserved repositories outside the holdout directory.
  const scanned = [
    ...walk(join(projectDir, 'bench', 'results')),
    ...walk(join(projectDir, 'bench', 'doctor')).filter((f) => !f.startsWith(holdoutDir)),
    ...walk(join(projectDir, 'bench', 'datasets')),
    ...walk(join(projectDir, 'docs', 'quality')).filter((f) => !/holdout|release-gates/.test(f)),
  ].filter((f) => /\.(json|md|tsv|js|mjs|txt)$/.test(f));
  const leaks = [];
  for (const file of scanned) {
    const text = readFileSync(file, 'utf8').toLowerCase();
    for (const name of names) if (text.includes(name)) leaks.push(`${relative(projectDir, file)} mentions ${name}`);
    for (const sha of commits) if (text.includes(sha)) leaks.push(`${relative(projectDir, file)} mentions ${sha}`);
  }
  check('no benchmark output, label or document outside the holdout directory references a reserved repository',
    leaks.length === 0, leaks.slice(0, 5).join('; '));

  const stray = walk(holdoutDir).map((f) => relative(holdoutDir, f).replace(/\\/g, '/'))
    .filter((f) => /(^|\/)(labels?|predictions?|results?|reports?|adjudicat|submissions?)[^/]*\.(tsv|json|csv)$/i.test(f)
      && !f.startsWith('templates/'));
  check('no label, prediction or report file inside the repository holdout directory', stray.length === 0, stray.join(', '));

  return { ok: checks.every((c) => c.ok), manifestSha256: digest, checks };
}

if (isMain(import.meta.url)) {
  try {
    const result = verifyInputs();
    if (process.argv.includes('--json')) console.log(JSON.stringify(result, null, 2));
    else {
      for (const c of result.checks) console.log(`${c.ok ? 'PASS' : 'FAIL'}  ${c.name}${c.detail && !c.ok ? `  [${c.detail}]` : ''}`);
      console.log(result.ok ? `\nHoldout reservation intact. SHA-256 ${result.manifestSha256}` : '\nHoldout reservation FAILED verification.');
    }
    process.exitCode = result.ok ? 0 : 1;
  } catch (error) {
    if (!(error instanceof ToolError)) throw error;
    console.error(error.message);
    process.exitCode = 2;
  }
}
