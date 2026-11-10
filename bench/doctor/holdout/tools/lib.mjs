// Shared helpers for the independent Doctor holdout tools. Dependency-free.
// None of these tools analyses repository content, runs repository code or contacts a service,
// except materialize.mjs, which fetches the pinned commits through Git.
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

export const isMain = (metaUrl) => Boolean(process.argv[1]) && pathToFileURL(resolve(process.argv[1])).href === metaUrl;

export const TOOLS_DIR = dirname(fileURLToPath(import.meta.url));
// The override exists for the synthetic end-to-end test, which must never touch the real reservation.
export const HOLDOUT_DIR = process.env.CONTEXTANVIL_HOLDOUT_DIR ? resolve(process.env.CONTEXTANVIL_HOLDOUT_DIR) : resolve(TOOLS_DIR, '..');
export const PROJECT_DIR = resolve(TOOLS_DIR, '..', '..', '..', '..');

export const CATEGORIES = ['missing', 'conflict', 'stale', 'unsafe', 'scan'];
export const VERDICTS = ['issue', 'security-issue', 'harmless', 'non-issue', 'ambiguous', 'unsupported'];
export const POSITIVE_VERDICTS = new Set(['issue', 'security-issue']);
export const NEGATIVE_VERDICTS = new Set(['harmless', 'non-issue']);
export const SEVERITIES = ['error', 'warning', 'info'];
export const CLASSES = ['defect', 'cue'];
export const SWEEP_STATUSES = ['not-swept', 'swept'];

export const LABEL_COLUMNS = [
  'opportunity_id', 'repo', 'commit', 'category', 'claim_id', 'source_path', 'source_line', 'reference',
  'scope', 'anchor_path', 'anchor_line', 'match_key', 'verdict', 'class', 'severity', 'next_action', 'rationale',
];
export const ADJUDICATION_COLUMNS = [
  'opportunity_id', 'repo', 'commit', 'category', 'claim_id', 'source_path', 'source_line', 'reference',
  'scope', 'anchor_path', 'anchor_line', 'match_key', 'verdict', 'class', 'severity', 'next_action', 'rationale',
  'r1_opportunity_id', 'r1_verdict', 'r2_opportunity_id', 'r2_verdict', 'disagreement', 'adjudication_rationale',
];
export const COVERAGE_COLUMNS = ['repo', 'instruction_path', 'claim_family', 'status', 'opportunities', 'positives', 'notes'];
export const AUDIT_COLUMNS = ['audit_id', 'repo', 'category', 'claim_id', 'path', 'line', 'claim_text'];
export const AUDIT_LABEL_COLUMNS = ['audit_id', 'verdict', 'class', 'severity', 'evidence_correct', 'rationale'];

export const sha256 = (data) => createHash('sha256').update(data).digest('hex');
export const lfText = (text) => text.replace(/\r\n/g, '\n');
export const lfDigest = (text) => sha256(Buffer.from(lfText(text), 'utf8'));
export const byCodeUnit = (a, b) => (a < b ? -1 : a > b ? 1 : 0);
export const readText = (path) => readFileSync(path, 'utf8');

export class ToolError extends Error {}
export function fail(message) {
  throw new ToolError(message);
}

/** Parse a TSV with a header row. A dash is kept as '-', never converted. */
export function parseTsv(text) {
  const lines = lfText(text).split('\n');
  while (lines.length && lines[lines.length - 1] === '') lines.pop();
  if (!lines.length) fail('Empty TSV.');
  const header = lines[0].split('\t');
  const rows = lines.slice(1).map((line, index) => {
    const cells = line.split('\t');
    if (cells.length !== header.length) {
      fail(`Line ${index + 2}: expected ${header.length} tab-separated columns, found ${cells.length}.`);
    }
    return Object.fromEntries(header.map((name, i) => [name, cells[i]]).concat([['_line', index + 2]]));
  });
  return { header, rows };
}

export function toTsv(columns, rows) {
  const clean = (value) => String(value ?? '-').replace(/[\t\r\n]+/g, ' ');
  return [columns.join('\t'), ...rows.map((row) => columns.map((c) => clean(row[c])).join('\t'))].join('\n') + '\n';
}

export const isDash = (value) => value === undefined || value === '' || value === '-';

export function loadClaims() {
  const { rows } = parseTsv(readText(join(HOLDOUT_DIR, 'claims.tsv')));
  return new Map(rows.map((row) => [row.claim_id, row]));
}

export function loadInputs(path = join(HOLDOUT_DIR, 'inputs.json')) {
  return JSON.parse(readText(path));
}

export function loadIdentities(path = join(HOLDOUT_DIR, 'identities.json')) {
  return JSON.parse(readText(path)).repositories;
}

export function loadExpected(path = join(HOLDOUT_DIR, 'identities.json')) {
  return JSON.parse(readText(path)).expected;
}

/** Instruction documents are the reserved paths whose base name is an agent instruction file. */
export function instructionPaths(inputs) {
  const re = /(^|\/)(AGENTS|CLAUDE|CLAUDE\.local|GEMINI)\.md$/;
  return inputs.flatMap((repo) => repo.paths.filter((p) => re.test(p.path)).map((p) => ({ repo: repo.repository, ...p })));
}

/** Exact one-sided binomial (Clopper-Pearson) bounds, computed from the binomial CDF. */
function logChoose(n, k) {
  let sum = 0;
  for (let i = 1; i <= k; i += 1) sum += Math.log((n - k + i) / i);
  return sum;
}
function binomialCdf(x, n, p) {
  if (p <= 0) return 1;
  if (p >= 1) return x >= n ? 1 : 0;
  let total = 0;
  for (let k = 0; k <= x; k += 1) total += Math.exp(logChoose(n, k) + k * Math.log(p) + (n - k) * Math.log(1 - p));
  return Math.min(1, total);
}
/** Smallest true proportion for which observing >= x successes in n trials still has probability alpha. */
export function lowerBound(x, n, alpha = 0.05) {
  if (!n) return null;
  if (x === 0) return 0;
  let lo = 0;
  let hi = 1;
  for (let i = 0; i < 60; i += 1) {
    const mid = (lo + hi) / 2;
    if (1 - binomialCdf(x - 1, n, mid) < alpha) lo = mid; else hi = mid;
  }
  return (lo + hi) / 2;
}
/** Largest true proportion for which observing <= x successes in n trials still has probability alpha. */
export function upperBound(x, n, alpha = 0.05) {
  if (!n) return null;
  if (x === n) return 1;
  let lo = 0;
  let hi = 1;
  for (let i = 0; i < 60; i += 1) {
    const mid = (lo + hi) / 2;
    if (binomialCdf(x, n, mid) > alpha) lo = mid; else hi = mid;
  }
  return (lo + hi) / 2;
}
/** Smallest number of trials with zero failures that proves proportion >= floor at the given confidence. */
export function zeroFailureTrials(floor, alpha = 0.05) {
  return Math.ceil(Math.log(alpha) / Math.log(floor));
}
