#!/usr/bin/env node
// Custodian tool: lock the evaluation before the candidate runs, and verify the lock afterwards.
//
//   node seal.mjs --workspace DIR [--allow-unvalidated-categories]
//
// Workspace layout (outside the repository, never committed):
//   materialized/  snapshots, listings, records       packages/R1, R2   review packages
//   submissions/R1, R2  labels.tsv, coverage-log.tsv, attestation.md (one directory per reviewer)
//   adjudication/adjudicated.tsv                      sealed/lock.json  the lock
//   runs/   raw output and run-record.json            audit/            post-run audit of unmatched findings
//   result/ result.json
// The lock records the candidate engine identity and the digest of every input to the evaluation, so
// a label, rule, gate or engine change after this point is detectable and refuses to run.
import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join, relative, resolve } from 'node:path';
import { validateLabels } from './check-labels.mjs';
import { verifyInputs } from './verify-inputs.mjs';
import {
  HOLDOUT_DIR, PROJECT_DIR, TOOLS_DIR, ToolError, fail, instructionPaths, isDash, isMain, lfDigest, loadIdentities, loadInputs, parseTsv,
  readText, sha256, CATEGORIES,
} from './lib.mjs';
import { computeCoverage, findOverlaps } from './score.mjs';

export const workspacePaths = (workspace) => {
  const ws = resolve(workspace);
  return {
    ws, materialized: join(ws, 'materialized'), submissions: join(ws, 'submissions'), adjudicated: join(ws, 'adjudication', 'adjudicated.tsv'),
    lock: join(ws, 'sealed', 'lock.json'), runs: join(ws, 'runs'), audit: join(ws, 'audit'), result: join(ws, 'result'),
  };
};

const FROZEN_DATA = ['inputs.json', 'identities.json', 'claims.tsv', 'gates.json', 'rubric.md', 'REVIEWER-INSTRUCTIONS.md'];
const FROZEN_TOOLS = ['lib.mjs', 'score.mjs', 'seal.mjs', 'execute.mjs', 'evaluate.mjs', 'check-labels.mjs'];

function git(args) {
  const result = spawnSync('git', args, { cwd: PROJECT_DIR, encoding: 'utf8' });
  if (result.status !== 0) fail(`git ${args.join(' ')} failed: ${result.stderr.split('\n')[0]}`);
  return result.stdout.trim();
}

export function engineIdentity() {
  const dirty = git(['status', '--porcelain', '--', 'src', 'bin', 'skills', 'package.json']);
  if (dirty) fail(`The candidate engine has uncommitted changes:\n${dirty}`);
  const check = spawnSync(process.execPath, ['scripts/sync-skill.js', '--check'], { cwd: PROJECT_DIR, encoding: 'utf8' });
  if (check.status !== 0) fail('The Skill engine copy is out of sync with src/. Run npm run skill:sync and commit.');
  return {
    commit: git(['rev-parse', 'HEAD']), src: git(['rev-parse', 'HEAD:src']), bin: git(['rev-parse', 'HEAD:bin']),
    skill: git(['rev-parse', 'HEAD:skills/contextanvil']), packageJson: git(['rev-parse', 'HEAD:package.json']),
  };
}

function readSubmission(paths, reviewer) {
  const dir = join(paths.submissions, reviewer);
  const files = { labels: join(dir, 'labels.tsv'), coverage: join(dir, 'coverage-log.tsv'), attestation: join(dir, 'attestation.md') };
  for (const file of Object.values(files)) if (!existsSync(file)) fail(`Missing ${relative(paths.ws, file)}`);
  const attestation = readText(files.attestation);
  if (/\[ \]/.test(attestation) || !/\[x\]/i.test(attestation)) fail(`${reviewer}: the attestation must have every box checked.`);
  return files;
}

export function createLock(workspace, { allowUnvalidatedCategories = false, engine = engineIdentity() } = {}) {
  const paths = workspacePaths(workspace);
  if (existsSync(paths.lock)) fail('The evaluation is already locked.');
  if (existsSync(paths.runs)) fail('A run directory already exists. The lock must come first.');
  const verification = verifyInputs();
  if (!verification.ok) fail('The holdout reservation failed verification.');
  const inputs = loadInputs();
  const identities = loadIdentities();
  const listingsDir = join(paths.materialized, 'listings');
  if (!existsSync(listingsDir)) fail('Materialize the snapshots first.');

  const submissions = { R1: readSubmission(paths, 'R1'), R2: readSubmission(paths, 'R2') };
  const parsed = {};
  for (const reviewer of ['R1', 'R2']) {
    const { errors, rows } = validateLabels(readText(submissions[reviewer].labels), {
      listingsDir, coverageText: readText(submissions[reviewer].coverage), final: true,
    });
    if (errors.length) fail(`${reviewer} labels are invalid:\n${errors.slice(0, 10).join('\n')}`);
    parsed[reviewer] = rows;
  }
  if (!existsSync(paths.adjudicated)) fail('Missing adjudication/adjudicated.tsv');
  const { errors, rows } = validateLabels(readText(paths.adjudicated), { adjudicated: true, listingsDir });
  if (errors.length) fail(`Adjudicated labels are invalid:\n${errors.slice(0, 10).join('\n')}`);

  const referenced = { R1: new Set(), R2: new Set() };
  for (const row of rows) {
    for (const reviewer of ['R1', 'R2']) {
      const id = row[`${reviewer.toLowerCase()}_opportunity_id`];
      if (!isDash(id)) referenced[reviewer].add(id);
    }
  }
  for (const reviewer of ['R1', 'R2']) {
    const dropped = parsed[reviewer].filter((r) => !referenced[reviewer].has(r.opportunity_id));
    if (dropped.length) fail(`${reviewer} opportunities are missing from the adjudication (${dropped.slice(0, 5).map((r) => r.opportunity_id).join(', ')}). Record every original decision.`);
  }
  const overlaps = findOverlaps(rows);
  if (overlaps.length) fail(`Overlapping selectors: ${overlaps.slice(0, 5).map((p) => p.join(' & ')).join('; ')}. Each opportunity needs a distinct matching rule.`);

  const swept = (reviewer) => {
    const log = parseTsv(readText(submissions[reviewer].coverage)).rows;
    return new Set(instructionPaths(inputs).filter((d) => CATEGORIES.every((c) => log.some((r) => r.repo === d.repo && r.instruction_path === d.path && r.claim_family === c && r.status === 'swept'))).map((d) => `${d.repo}/${d.path}`));
  };
  const both = [...swept('R1')].filter((d) => swept('R2').has(d)).length;
  const gates = JSON.parse(readText(join(HOLDOUT_DIR, 'gates.json')));
  if (gates.status !== 'ratified') fail('gates.json must have status "ratified" (set by the maintainers, in a reviewed commit) before the lock.');
  const coverage = computeCoverage(rows, identities, gates, both);
  if (!coverage.overall.validated) fail(`Overall coverage is below the pre-registered minimum:\n${JSON.stringify(coverage.overall, null, 2)}\nReserve additional pinned inputs before any candidate run.`);
  const unvalidated = Object.entries(coverage.categories).filter(([, v]) => !v.validated).map(([k]) => k);
  if (unvalidated.length && !allowUnvalidatedCategories) fail(`Categories below their minimum: ${unvalidated.join(', ')}. Expand them, or lock with --allow-unvalidated-categories to record them as unvalidated.`);

  const digests = {};
  for (const name of FROZEN_DATA) digests[name] = lfDigest(readText(join(HOLDOUT_DIR, name)));
  for (const name of FROZEN_TOOLS) digests[`tools/${name}`] = lfDigest(readText(join(TOOLS_DIR, name)));
  const external = {
    'R1/labels.tsv': submissions.R1.labels, 'R2/labels.tsv': submissions.R2.labels, 'R1/coverage-log.tsv': submissions.R1.coverage,
    'R2/coverage-log.tsv': submissions.R2.coverage, 'R1/attestation.md': submissions.R1.attestation, 'R2/attestation.md': submissions.R2.attestation,
    'adjudicated.tsv': paths.adjudicated,
  };
  const workspaceDigests = Object.fromEntries(Object.entries(external).map(([k, f]) => [k, lfDigest(readText(f))]));
  const records = Object.fromEntries(inputs.map((r) => {
    const record = JSON.parse(readText(join(paths.materialized, 'records', `${r.repository.replace('/', '--')}.json`)));
    const identity = identities.find((i) => i.repository === r.repository);
    if (record.tree !== identity.tree || record.commit !== r.commit) fail(`${r.repository}: materialized tree differs from the recorded identity`);
    return [r.repository, { tree: record.tree, listingSha256: record.listingSha256, unavailable: record.unavailable.length }];
  }));
  const lock = {
    version: 1, engine, manifestSha256: verification.manifestSha256, frozenFiles: digests, workspaceFiles: workspaceDigests,
    snapshots: records, coverage, unvalidatedCategories: unvalidated,
    note: 'Candidate engine, labels, rules and gates are fixed. A change to any recorded digest invalidates the evaluation.',
  };
  mkdirSync(join(paths.ws, 'sealed'), { recursive: true });
  writeFileSync(paths.lock, `${JSON.stringify(lock, null, 2)}\n`, { flag: 'wx' });
  return lock;
}

/** Re-verify the lock. Returns the lock. Fails on any difference in the engine, rules, labels or snapshots. */
export function verifyLock(workspace, { engine = engineIdentity() } = {}) {
  const paths = workspacePaths(workspace);
  if (!existsSync(paths.lock)) fail('The evaluation is not locked. Run seal.mjs first.');
  const lock = JSON.parse(readFileSync(paths.lock, 'utf8'));
  for (const key of ['src', 'bin', 'skill', 'packageJson']) {
    if (engine[key] !== lock.engine[key]) fail(`The candidate engine changed after the lock (${key}). The evaluation is void; rebuild the labels on fresh inputs.`);
  }
  for (const [name, digest] of Object.entries(lock.frozenFiles)) {
    const file = name.startsWith('tools/') ? join(TOOLS_DIR, name.slice(6)) : join(HOLDOUT_DIR, name);
    if (lfDigest(readText(file)) !== digest) fail(`${name} changed after the lock.`);
  }
  const map = {
    'R1/labels.tsv': join(paths.submissions, 'R1', 'labels.tsv'), 'R2/labels.tsv': join(paths.submissions, 'R2', 'labels.tsv'),
    'R1/coverage-log.tsv': join(paths.submissions, 'R1', 'coverage-log.tsv'), 'R2/coverage-log.tsv': join(paths.submissions, 'R2', 'coverage-log.tsv'),
    'R1/attestation.md': join(paths.submissions, 'R1', 'attestation.md'), 'R2/attestation.md': join(paths.submissions, 'R2', 'attestation.md'),
    'adjudicated.tsv': paths.adjudicated,
  };
  for (const [name, digest] of Object.entries(lock.workspaceFiles)) {
    if (lfDigest(readText(map[name])) !== digest) fail(`${name} changed after the lock.`);
  }
  return lock;
}

export const fingerprint = (text) => sha256(text).slice(0, 8);

if (isMain(import.meta.url)) {
  const args = process.argv.slice(2);
  try {
    const workspace = args[args.indexOf('--workspace') + 1];
    if (!args.includes('--workspace') || !workspace) fail('Usage: node seal.mjs --workspace DIR [--allow-unvalidated-categories]');
    const lock = createLock(workspace, { allowUnvalidatedCategories: args.includes('--allow-unvalidated-categories') });
    console.log(`Locked candidate ${lock.engine.commit} (src tree ${lock.engine.src}).`);
    console.log(`Unvalidated categories: ${lock.unvalidatedCategories.join(', ') || 'none'}.`);
    console.log(`Lock written to ${workspacePaths(workspace).lock}. Do not change the engine, labels, rules or gates.`);
  } catch (error) {
    if (!(error instanceof ToolError)) throw error;
    console.error(error.message);
    process.exitCode = 2;
  }
}
