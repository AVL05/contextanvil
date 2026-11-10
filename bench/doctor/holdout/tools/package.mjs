#!/usr/bin/env node
// Custodian tool: build one reviewer's review package from materialized snapshots.
//
//   node package.mjs --workspace DIR --materialized DIR --reviewer R1|R2
//   node write-templates.mjs            (regenerates ../templates from the schema)
//
// A package holds the rubric, claim taxonomy, pinned metadata, tree listings, a blank label file, a
// pre-populated coverage log and an attestation form. It never holds the other reviewer's data,
// candidate output or Doctor results. Both packages carry the same COMMON-DIGEST so that equal
// material is provable. Packages are written under DIR/packages/<id>; submissions go to DIR/submissions/<id>.
import { copyFileSync, existsSync, mkdirSync, readdirSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import {
  CATEGORIES, COVERAGE_COLUMNS, HOLDOUT_DIR, LABEL_COLUMNS, ToolError, fail, instructionPaths, isMain, loadIdentities,
  loadInputs, readText, sha256, toTsv, byCodeUnit,
} from './lib.mjs';

const COMMON_FILES = [
  ['REVIEWER-INSTRUCTIONS.md', 'REVIEWER-INSTRUCTIONS.md'],
  ['rubric.md', 'rubric.md'],
  ['claims.tsv', 'claims.tsv'],
  ['inputs.json', 'inputs.json'],
  ['identities.json', 'identities.json'],
  ['templates/attestation.md', 'attestation.md'],
];

export function coverageTemplate(inputs) {
  const rows = [];
  for (const repo of [...inputs].sort((a, b) => byCodeUnit(a.repository, b.repository))) {
    for (const category of CATEGORIES) {
      rows.push({ repo: repo.repository, instruction_path: '-', claim_family: category, status: 'not-swept', opportunities: 0, positives: 0, notes: '-' });
    }
  }
  for (const doc of instructionPaths(inputs).sort((a, b) => byCodeUnit(`${a.repo}/${a.path}`, `${b.repo}/${b.path}`))) {
    for (const category of CATEGORIES) {
      rows.push({ repo: doc.repo, instruction_path: doc.path, claim_family: category, status: 'not-swept', opportunities: 0, positives: 0, notes: '-' });
    }
  }
  return toTsv(COVERAGE_COLUMNS, rows);
}

export function buildPackage({ workspace, materialized, reviewer, inputs = loadInputs() }) {
  if (!/^R[12]$/.test(reviewer ?? '')) fail('--reviewer must be R1 or R2');
  if (!workspace || !materialized) fail('--workspace and --materialized are required');
  const ws = resolve(workspace);
  const source = resolve(materialized);
  const out = join(ws, 'packages', reviewer);
  if (existsSync(out)) fail(`${out} already exists. A package is built once.`);
  for (const repo of inputs) {
    const slug = repo.repository.replace('/', '--');
    for (const part of [`records/${slug}.json`, `listings/${slug}.tsv`, `snapshots/${slug}`]) {
      if (!existsSync(join(source, part))) fail(`Materialized output is incomplete: missing ${part}`);
    }
  }
  mkdirSync(out, { recursive: true });
  mkdirSync(join(out, 'listings'));
  mkdirSync(join(out, 'records'));
  const common = [];
  for (const [from, to] of COMMON_FILES) {
    copyFileSync(join(HOLDOUT_DIR, from), join(out, to));
    common.push([to, sha256(readText(join(out, to)))]);
  }
  for (const repo of inputs) {
    const slug = repo.repository.replace('/', '--');
    for (const [dir, ext] of [['listings', 'tsv'], ['records', 'json']]) {
      copyFileSync(join(source, dir, `${slug}.${ext}`), join(out, dir, `${slug}.${ext}`));
      common.push([`${dir}/${slug}.${ext}`, sha256(readText(join(out, dir, `${slug}.${ext}`)))]);
    }
  }
  const paths = Object.fromEntries(inputs.map((r) => [r.repository, join(source, 'snapshots', r.repository.replace('/', '--'))]));
  writeFileSync(join(out, 'snapshot-paths.json'), JSON.stringify(paths, null, 2) + '\n');
  writeFileSync(join(out, 'labels.tsv'), toTsv(LABEL_COLUMNS, []));
  writeFileSync(join(out, 'coverage-log.tsv'), coverageTemplate(inputs));
  const commonDigest = sha256(common.sort((a, b) => byCodeUnit(a[0], b[0])).map(([n, h]) => `${h}  ${n}`).join('\n') + '\n');
  writeFileSync(join(out, 'COMMON-DIGEST'), `${commonDigest}\n`);
  writeFileSync(join(out, 'reviewer.txt'), `${reviewer}\n`);
  mkdirSync(join(ws, 'submissions', reviewer), { recursive: true });
  loadIdentities();
  return { out, commonDigest, files: readdirSync(out).length };
}

if (isMain(import.meta.url)) {
  const args = process.argv.slice(2);
  const value = (flag) => (args.includes(flag) ? args[args.indexOf(flag) + 1] : undefined);
  try {
    const result = buildPackage({ workspace: value('--workspace'), materialized: value('--materialized'), reviewer: value('--reviewer') });
    console.log(`Package ${result.out}\nCOMMON-DIGEST ${result.commonDigest}`);
    console.log('Give the reviewer this directory and the read-only snapshots only. Never share submissions.');
  } catch (error) {
    if (!(error instanceof ToolError)) throw error;
    console.error(error.message);
    process.exitCode = 2;
  }
}
