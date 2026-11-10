#!/usr/bin/env node
// Custodian tool: run the locked candidate exactly once on the read-only snapshots.
//
//   node execute.mjs --workspace DIR
//
// It refuses to run unless the lock verifies, and refuses a second run. Doctor runs as a separate
// process with `doctor <snapshot> --json --fail-on never`. Each snapshot is checked against its pinned
// listing before and after, the output is repeated once to check determinism, and every output byte
// is checked. Credential suspects are recorded only as fingerprints. Raw output stays outside the repository.
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync, lstatSync, mkdirSync, readFileSync, readdirSync, readlinkSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { arch, cpus, platform, release } from 'node:os';
import { PROJECT_DIR, ToolError, fail, isDash, isMain, loadInputs, parseTsv, POSITIVE_VERDICTS, readText } from './lib.mjs';
import { fingerprint, verifyLock, workspacePaths } from './seal.mjs';

const blobId = (data) => createHash('sha1').update(`blob ${data.length}\0`).update(data).digest('hex');

/** Compare a snapshot directory with its pinned listing. Returns the number of differences. */
export function snapshotDifferences(snapshot, listingRows, unavailable = []) {
  const expected = new Map(listingRows.filter((r) => r.type === 'blob').map((r) => [r.path, r.blob_sha]));
  const skip = new Set(unavailable.map((u) => u.path));
  const actual = new Map();
  const walk = (dir, prefix) => {
    for (const name of readdirSync(dir)) {
      const full = join(dir, name);
      const rel = prefix ? `${prefix}/${name}` : name;
      const stat = lstatSync(full);
      if (stat.isSymbolicLink()) actual.set(rel, blobId(Buffer.from(readlinkSync(full))));
      else if (stat.isDirectory()) walk(full, rel);
      else actual.set(rel, blobId(readFileSync(full)));
    }
  };
  walk(snapshot, '');
  let differences = 0;
  for (const [path, sha] of expected) if (!skip.has(path) && actual.get(path) !== sha) differences += 1;
  for (const path of actual.keys()) if (!expected.has(path)) differences += 1;
  return differences;
}

const nonAsciiBytes = (buffer) => [...buffer].filter((b) => !(b === 0x0a || b === 0x09 || (b >= 0x20 && b <= 0x7e))).length;

function leakSuspects(snapshot, repo, rows) {
  const suspects = [];
  for (const row of rows.filter((r) => r.repo === repo && r.claim_id === 'secret-in-instructions' && POSITIVE_VERDICTS.has(r.verdict) && !isDash(r.source_path) && !isDash(r.source_line))) {
    const file = join(snapshot, ...row.source_path.split('/'));
    if (!existsSync(file)) continue;
    const line = readText(file).split(/\r?\n/)[Number(row.source_line) - 1] ?? '';
    for (const token of line.match(/[A-Za-z0-9+/=_.-]{16,}/g) ?? []) {
      if (/\d/.test(token) && /[A-Za-z]/.test(token) && !(token.includes('/') && token.includes('.'))) suspects.push({ opportunity: row.opportunity_id, token });
    }
  }
  return suspects;
}

export function execute(workspace, options = {}) {
  const paths = workspacePaths(workspace);
  const lock = verifyLock(workspace, options);
  if (existsSync(join(paths.runs, 'run-record.json'))) fail('The locked candidate has already run. A second run is not allowed; use a fresh evaluation.');
  mkdirSync(join(paths.runs, 'raw'), { recursive: true });
  mkdirSync(join(paths.runs, 'reports'), { recursive: true });
  const inputs = loadInputs();
  const adjudicated = parseTsv(readText(paths.adjudicated)).rows;
  const record = {
    candidate: lock.engine, node: process.version, os: `${platform()} ${release()} ${arch()}`, cpu: cpus()[0]?.model ?? 'unknown',
    command: 'node bin/contextanvil.js doctor <snapshot> --json --fail-on never', startedFrom: 'engine tree verified against the lock',
    repositories: [],
  };
  const summary = { credentialValues: 0, nonAsciiBytes: 0, snapshotModifications: 0, nonDeterministic: 0, failures: 0 };
  for (const input of inputs) {
    const slug = input.repository.replace('/', '--');
    const snapshot = join(paths.materialized, 'snapshots', slug);
    const listing = parseTsv(readText(join(paths.materialized, 'listings', `${slug}.tsv`))).rows;
    const unavailable = JSON.parse(readText(join(paths.materialized, 'records', `${slug}.json`))).unavailable;
    const before = snapshotDifferences(snapshot, listing, unavailable);
    if (before) fail(`${input.repository}: the snapshot differs from the pinned tree before the run (${before} differences).`);
    const runOnce = () => {
      const start = process.hrtime.bigint();
      const result = spawnSync(process.execPath, [join(PROJECT_DIR, 'bin', 'contextanvil.js'), 'doctor', snapshot, '--json', '--fail-on', 'never'], {
        cwd: PROJECT_DIR, maxBuffer: 1 << 29, timeout: 900_000,
        env: { PATH: process.env.PATH, SystemRoot: process.env.SystemRoot, HOME: process.env.HOME, USERPROFILE: process.env.USERPROFILE, NO_COLOR: '1' },
      });
      return { ...result, milliseconds: Number(process.hrtime.bigint() - start) / 1e6 };
    };
    const first = runOnce();
    const second = runOnce();
    const normalize = (buffer) => buffer.toString('utf8').split(snapshot).join('<ROOT>').split(JSON.stringify(snapshot).slice(1, -1)).join('<ROOT>');
    writeFileSync(join(paths.runs, 'raw', `${slug}.stdout`), first.stdout ?? Buffer.alloc(0));
    writeFileSync(join(paths.runs, 'raw', `${slug}.stderr`), first.stderr ?? Buffer.alloc(0));
    let report = null;
    try { report = JSON.parse(normalize(first.stdout)); } catch { report = null; }
    if (report) writeFileSync(join(paths.runs, 'reports', `${slug}.json`), `${JSON.stringify(report, null, 2)}\n`);
    const identical = normalize(first.stdout) === normalize(second.stdout) && first.status === second.status;
    const after = snapshotDifferences(snapshot, listing, unavailable);
    const suspects = leakSuspects(snapshot, input.repository, adjudicated);
    const combined = Buffer.concat([first.stdout ?? Buffer.alloc(0), first.stderr ?? Buffer.alloc(0)]).toString('latin1');
    const hits = suspects.filter((s) => combined.includes(s.token)).map((s) => `${input.repository}:${s.opportunity}:${fingerprint(s.token)}`);
    const failed = first.status !== 0 || (first.stderr?.length ?? 0) > 0 || !report || report.findings?.some((f) => f.id === 'detector-failed');
    const bad = nonAsciiBytes(Buffer.concat([first.stdout ?? Buffer.alloc(0), first.stderr ?? Buffer.alloc(0)]));
    summary.nonAsciiBytes += bad;
    summary.snapshotModifications += after;
    summary.nonDeterministic += identical ? 0 : 1;
    summary.failures += failed ? 1 : 0;
    summary.credentialValues += hits.length;
    record.repositories.push({
      repository: input.repository, exitStatus: first.status, repeatExitStatus: second.status, milliseconds: first.milliseconds,
      stdoutBytes: first.stdout?.length ?? 0, stderrBytes: first.stderr?.length ?? 0, findings: report?.findings?.length ?? null,
      identicalRepeat: identical, snapshotDifferencesAfter: after, nonAsciiBytes: bad, leakSuspects: hits, failed,
    });
  }
  record.summary = summary;
  writeFileSync(join(paths.runs, 'run-record.json'), `${JSON.stringify(record, null, 2)}\n`, { flag: 'wx' });
  return record;
}

if (isMain(import.meta.url)) {
  const args = process.argv.slice(2);
  try {
    if (!args.includes('--workspace')) fail('Usage: node execute.mjs --workspace DIR');
    const record = execute(args[args.indexOf('--workspace') + 1]);
    console.log(JSON.stringify(record.summary, null, 2));
    console.log(`Run record: ${join(workspacePaths(args[args.indexOf('--workspace') + 1]).runs, 'run-record.json')}`);
  } catch (error) {
    if (!(error instanceof ToolError)) throw error;
    console.error(error.message);
    process.exitCode = 2;
  }
}
