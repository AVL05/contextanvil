import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import {
  chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = import.meta.dirname;
const project = fileURLToPath(new URL('../../', import.meta.url));
const hash = (bytes) => createHash('sha256').update(bytes).digest('hex');
const categories = ['missing', 'conflict', 'stale', 'unsafe', 'scan'];
const verdicts = ['issue', 'security-issue', 'non-issue', 'harmless', 'ambiguous', 'unsupported'];

const output = process.argv[2];
assert(process.argv.length === 3 && output, 'Usage: node bench/doctor/run.js RESULT.json');
const freeze = JSON.parse(readFileSync(join(here, 'freeze.json')));
function frozenFile(name) {
  const bytes = readFileSync(join(here, name));
  assert.equal(hash(bytes.toString('utf8').replace(/\r\n/g, '\n')), freeze[name], `${name} differs from the frozen input`);
  return bytes.toString('utf8');
}
const corpus = JSON.parse(frozenFile('corpus.json'));
frozenFile('README.md');
const [header, ...rows] = frozenFile('labels.tsv').trimEnd().split(/\r?\n/);
assert.equal(header, 'repo\tcategory\tid\tverdict\tpath\tline\tkey\tseverity\trationale');
const labels = rows.map((row, index) => {
  const columns = row.split('\t').map((column) => column === '-' ? null : column);
  assert.equal(columns.length, 9, `Invalid label on row ${index + 2}`);
  const [repo, category, id, verdict, path, line, key, severity, rationale] = columns;
  assert(corpus.repositories.some((item) => item.repo === repo));
  assert(categories.includes(category) && verdicts.includes(verdict) && id && rationale);
  assert(line === null || (path && /^[1-9]\d*$/.test(line)));
  assert(verdict.endsWith('issue') && verdict !== 'non-issue'
    ? ['error', 'warning', 'info'].includes(severity) : severity === null);
  return { row: index + 2, repo, category, id, verdict, path, line: line && Number(line), key, severity, rationale };
});

function lockSnapshot(root, locked) {
  const mode = locked ? 0o444 : 0o644;
  if (!locked && process.platform !== 'win32') chmodSync(root, 0o755);
  for (const entry of readdirSync(root, { withFileTypes: true })) {
    const path = join(root, entry.name);
    if (entry.isDirectory()) lockSnapshot(path, locked);
    else if (entry.isFile()) chmodSync(path, mode);
  }
  if (locked && process.platform !== 'win32') chmodSync(root, 0o555);
}

async function archiveBytes(repo, commit, slug) {
  const cache = process.env.DOCTOR_ARCHIVE_CACHE;
  const local = cache && join(cache, `${slug}.tar.gz`);
  if (local && existsSync(local)) return readFileSync(local);
  const response = await fetch(`https://codeload.github.com/${repo}/tar.gz/${commit}`, {
    signal: AbortSignal.timeout(180_000),
  });
  assert(response.ok, `Download failed for ${repo} (${response.status})`);
  return Buffer.from(await response.arrayBuffer());
}

async function scan(item, scratch) {
  const { repo, commit, archiveSha256, instructions, ecosystem } = item;
  assert.match(repo, /^[\w.-]+\/[\w.-]+$/);
  assert.match(commit, /^[0-9a-f]{40}$/);
  const slug = repo.replace('/', '--');
  const bytes = await archiveBytes(repo, commit, slug);
  assert.equal(hash(bytes), archiveSha256, `Archive checksum mismatch for ${repo}`);
  const archive = join(scratch, `${slug}.tar.gz`);
  const root = join(scratch, slug);
  writeFileSync(archive, bytes);
  mkdirSync(root);
  try {
    // bsdtar's default secure extraction rejects absolute/traversing paths
    // and writes through symlinks. Never enable -P.
    execFileSync('tar', ['-xf', archive, '--strip-components', '1', '-C', root], { cwd: scratch });
    for (const path of instructions) assert(existsSync(join(root, path)), `Missing instruction ${repo}:${path}`);
    lockSnapshot(root, true);
    const stdout = execFileSync(process.execPath, [
      join(project, 'bin/contextanvil.js'), 'doctor', root, '--json', '--fail-on', 'never',
    ], { cwd: project, encoding: 'utf8', maxBuffer: 32 * 1024 * 1024, timeout: 120_000 });
    const { root: absoluteRoot, ...report } = JSON.parse(stdout);
    assert(absoluteRoot && Array.isArray(report.findings));
    return { repo, commit, ecosystem, report };
  } finally {
    lockSnapshot(root, false);
    rmSync(root, { recursive: true, force: true });
    rmSync(archive, { force: true });
  }
}

function score(reports) {
  const cases = [];
  const unmatched = [];
  for (const { repo, ecosystem, report } of reports) {
    const repoCases = labels.filter((label) => label.repo === repo).map((label) => ({ ...label, ecosystem, findings: [] }));
    cases.push(...repoCases);
    report.findings.forEach((finding, index) => {
      const matches = repoCases.filter((label) =>
        label.id === finding.id && label.category === finding.category
        && (!label.key || finding.title.includes(label.key))
        && (!label.path || finding.evidence.some((evidence) => evidence.path === label.path
          && (!label.line || label.key || evidence.line === label.line))));
      assert(matches.length <= 1, `Overlapping frozen selectors for ${repo} finding ${index + 1}`);
      if (matches.length === 1 && matches[0].findings.length === 0) matches[0].findings.push(index + 1);
      else unmatched.push({ repo, ecosystem, finding: index + 1, duplicateOfRow: matches[0]?.row });
    });
    for (const label of repoCases) {
      const finding = report.findings[label.findings[0] - 1];
      if (label.verdict === 'unsupported' || label.verdict === 'ambiguous') label.result = label.verdict;
      else if (label.severity) label.result = finding ? 'TP' : 'FN';
      else label.result = finding ? 'FP' : 'TN';
      if (label.result === 'TP') {
        label.evidenceCorrect = label.path
          ? finding.evidence.some((item) => item.path === label.path && (!label.line || item.line === label.line))
          : finding.evidence.length === 0;
        label.severityCorrect = finding.severity === label.severity;
      }
    }
  }
  return { cases, unmatched };
}

function ratio(success, total) {
  if (!total) return null;
  const value = success / total;
  const z = 1.96;
  const scale = 1 + z ** 2 / total;
  const center = (value + z ** 2 / (2 * total)) / scale;
  const margin = z * Math.sqrt(value * (1 - value) / total + z ** 2 / (4 * total ** 2)) / scale;
  return { success, total, value, wilson95: [Math.max(0, center - margin), Math.min(1, center + margin)] };
}

function metrics(cases) {
  const count = (result) => cases.filter((item) => item.result === result).length;
  const [TP, FP, FN, TN] = ['TP', 'FP', 'FN', 'TN'].map(count);
  const f1Denominator = 2 * TP + FP + FN;
  return {
    TP, FP, FN, TN, ambiguous: count('ambiguous'), unsupported: count('unsupported'),
    precision: ratio(TP, TP + FP), recall: ratio(TP, TP + FN),
    f1: f1Denominator ? 2 * TP / f1Denominator : null,
    falsePositiveRate: ratio(FP, FP + TN),
    evidenceAccuracy: ratio(cases.filter((item) => item.evidenceCorrect).length, TP),
    severityAccuracy: ratio(cases.filter((item) => item.severityCorrect).length, TP),
  };
}

const scratch = mkdtempSync(join(tmpdir(), 'contextanvil-doctor-'));
try {
  const reports = [];
  for (const item of corpus.repositories) reports.push(await scan(item, scratch));
  const { cases, unmatched } = score(reports);
  const by = (field, values) => Object.fromEntries(values.map((value) => [
    value, metrics(cases.filter((item) => item[field] === value)),
  ]));
  const summary = {
    overall: metrics(cases),
    byCategory: by('category', categories),
    byEcosystem: by('ecosystem', [...new Set(corpus.repositories.map((item) => item.ecosystem))]),
    byId: by('id', [...new Set(cases.map((item) => item.id))].sort()),
  };
  const engineHead = execFileSync('git', ['rev-parse', 'HEAD'], { cwd: project, encoding: 'utf8' }).trim();
  const runtimeDiff = execFileSync('git', ['status', '--porcelain', '--', 'src', 'bin'], {
    cwd: project, encoding: 'utf8',
  });
  assert.equal(runtimeDiff, '', 'Commit or restore engine changes before recording a benchmark');
  writeFileSync(resolve(output), JSON.stringify({
    baselineEngine: corpus.engineCommit, engineHead, node: process.version, platform: process.platform,
    freeze, summary, cases, unmatched, reports,
  }, null, 2) + '\n');
} finally {
  rmSync(scratch, { recursive: true, force: true });
}
