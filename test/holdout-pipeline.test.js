// End-to-end test of the independent holdout pipeline on SYNTHETIC repositories only.
// It points the tools at a temporary holdout directory (CONTEXTANVIL_HOLDOUT_DIR), so it can never read,
// materialize or score the reserved repositories. The candidate engine is the working tree, and the
// engine identity check is injected because a developer's working tree may be dirty.
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import {
  chmodSync, cpSync, existsSync, lstatSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';

const base = mkdtempSync(join(tmpdir(), 'contextanvil-holdout-'));
const holdout = join(base, 'holdout');
process.env.CONTEXTANVIL_HOLDOUT_DIR = holdout;
const real = fileURLToPath(new URL('../bench/doctor/holdout/', import.meta.url));
const tools = '../bench/doctor/holdout/tools/';
const lib = await import(`${tools}lib.mjs`);
const { materialize } = await import(`${tools}materialize.mjs`);
const { buildPackage, coverageTemplate } = await import(`${tools}package.mjs`);
const { validateLabels, coverageKey } = await import(`${tools}check-labels.mjs`);
const { verifyInputs } = await import(`${tools}verify-inputs.mjs`);
const { createLock, verifyLock } = await import(`${tools}seal.mjs`);
const { execute, snapshotDifferences } = await import(`${tools}execute.mjs`);
const { evaluate, makeAudit } = await import(`${tools}evaluate.mjs`);

const gitAvailable = spawnSync('git', ['--version']).status === 0;
const ENGINE = { commit: 'test', src: 'src', bin: 'bin', skill: 'skill', packageJson: 'pkg' };
const git = (cwd, ...args) => {
  const r = spawnSync('git', ['-c', 'user.email=t@example.com', '-c', 'user.name=t', '-c', 'commit.gpgsign=false', ...args], { cwd, encoding: 'utf8' });
  assert.equal(r.status, 0, r.stderr);
  return r.stdout.trim();
};

function unlock(dir) {
  if (!existsSync(dir)) return;
  for (const name of readdirSync(dir)) {
    const full = join(dir, name);
    const stat = lstatSync(full);
    if (stat.isSymbolicLink()) continue;
    try { chmodSync(full, 0o777); } catch { /* best effort */ }
    if (stat.isDirectory()) unlock(full);
  }
  try { chmodSync(dir, 0o777); } catch { /* best effort */ }
}
test.after(() => { unlock(base); rmSync(base, { recursive: true, force: true }); });

const GATES = {
  version: 1, status: 'ratified', confidence: { alpha: 0.05 },
  coverage: {
    overall: { minDeterminateDefectPositives: 3, minDeterminateNegatives: 3, minRepositoriesWithDefectPositives: 3, maxRepositoryShareOfDefectPositives: 0.5, minInstructionDocumentsSwept: 3 },
    perCategory: { minDeterminateDefectPositives: 1, minDeterminateNegatives: 1 }, cues: { minDeterminateCues: 3 }, security: { minDeterminateSecurityPositives: 5 },
  },
  accuracy: {
    defectPrecision: { floor: 0.3 }, defectRecall: { floor: 0.3 }, falsePositiveRate: { ceiling: 0.7 }, cueFactualAccuracy: { floor: 0.3 },
    evidenceCorrectness: { floor: 0.3 }, severityExactAgreement: { floor: 0.3 }, leaveOneRepositoryOut: { pointEstimateMustClearFloor: true },
  },
  security: Object.fromEntries(['errorSeverityFalsePositives', 'credentialValuesInOutput', 'nonAsciiOrControlBytesInOutput', 'evidencePathsOutsideSnapshot',
    'snapshotModifications', 'nonDeterministicRepeats', 'uncaughtFailures'].map((k) => [k, { max: 0 }])),
  runtime: { pairedRuns: 7, maxMedianLatencyRatio: 1.2, maxMedianPeakRssRatio: 1.2 },
};

const guide = (name, extra) => `# ${name} agent guide

This repository holds a small build tool. Keep changes focused and well tested.

Run \`npm run lint\` before you commit any change to the repository.
Run \`npm run build\` to compile the project into the dist directory.
${extra}`;

function buildWorld(name, variant) {
  const root = join(base, name);
  const remotes = join(root, 'remotes');
  const inputs = [];
  const identities = [];
  const extras = { beta: variant === 'falsePositive' ? 'Run `npm run format` to tidy the sources.\n' : '', gamma: variant === 'unaudited' ? 'Run `npm run test:e2e` to exercise the whole tool.\n' : '' };
  for (const repo of ['alpha', 'beta', 'gamma']) {
    const dir = join(remotes, 'acme', repo);
    mkdirSync(dir, { recursive: true });
    git(dir, 'init', '--quiet');
    writeFileSync(join(dir, 'AGENTS.md'), guide(repo, extras[repo] ?? ''));
    writeFileSync(join(dir, 'package.json'), `{"name":"${repo}","version":"1.0.0","scripts":{"build":"node build.js"}}\n`);
    writeFileSync(join(dir, '.gitignore'), 'node_modules\n');
    writeFileSync(join(dir, 'build.js'), '// build\n');
    git(dir, 'add', '.');
    git(dir, 'commit', '--quiet', '-m', 'init');
    const commit = git(dir, 'rev-parse', 'HEAD');
    const tree = git(dir, 'rev-parse', `${commit}^{tree}`);
    const sha = git(dir, 'rev-parse', `${commit}:AGENTS.md`);
    inputs.push({ repository: `acme/${repo}`, commit, tree: commit, licenseMetadata: 'MIT', paths: [{ mode: '100644', path: 'AGENTS.md', sha }] });
    identities.push({ repository: `acme/${repo}`, commit, tree, ecosystem: 'JavaScript' });
  }
  mkdirSync(join(holdout, 'templates'), { recursive: true });
  for (const f of ['claims.tsv', 'rubric.md', 'REVIEWER-INSTRUCTIONS.md', 'templates/attestation.md']) cpSync(join(real, f), join(holdout, f));
  const inputsText = `${JSON.stringify(inputs, null, 2)}\n`;
  writeFileSync(join(holdout, 'inputs.json'), inputsText);
  writeFileSync(join(holdout, 'README.md'), `Digest \`${lib.lfDigest(inputsText)}\`.\n`);
  writeFileSync(join(holdout, 'identities.json'), `${JSON.stringify({ expected: { repositories: 3, instructionPaths: 3 }, repositories: identities }, null, 2)}\n`);
  writeFileSync(join(holdout, 'gates.json'), `${JSON.stringify(GATES, null, 2)}\n`);
  return { ws: join(root, 'ws'), remotes, inputs };
}

const blank = Object.fromEntries(lib.LABEL_COLUMNS.map((c) => [c, '-']));
function labelsFor(inputs, prefix, variant) {
  const rows = [];
  for (const input of inputs) {
    const common = { ...blank, repo: input.repository, commit: input.commit };
    const slug = input.repository.split('/')[1];
    rows.push({
      ...common, opportunity_id: `${prefix}-${slug}-1`, category: 'stale', claim_id: 'missing-script-reference', source_path: 'AGENTS.md', source_line: '5',
      reference: 'lint', scope: 'root package', anchor_path: 'AGENTS.md', anchor_line: '5', match_key: '"lint"', verdict: 'issue', class: 'defect', severity: 'warning',
      next_action: 'Define a lint script or remove the instruction.', rationale: 'The guide tells agents to run lint and the root manifest defines no such script.',
    }, {
      ...common, opportunity_id: `${prefix}-${slug}-2`, category: 'stale', claim_id: 'missing-script-reference', source_path: 'AGENTS.md', source_line: '6',
      reference: 'build', scope: 'root package', anchor_path: 'AGENTS.md', anchor_line: '6', match_key: '"build"', verdict: 'non-issue',
      rationale: 'The build script is defined in the root manifest, so the instruction resolves.',
    }, {
      ...common, opportunity_id: `${prefix}-${slug}-3`, category: 'missing', claim_id: 'agents-without-claude', source_path: 'AGENTS.md', reference: '-',
      scope: 'repository', anchor_path: 'AGENTS.md', verdict: 'issue', class: 'cue', severity: 'info',
      rationale: 'The repository has an AGENTS.md and no CLAUDE.md, which is a useful cue for clients that read only the latter.',
    });
    if (variant === 'falsePositive' && slug === 'beta') {
      rows.push({
        ...common, opportunity_id: `${prefix}-${slug}-4`, category: 'stale', claim_id: 'missing-script-reference', source_path: 'AGENTS.md', source_line: '7',
        reference: 'format', scope: 'optional step', anchor_path: 'AGENTS.md', anchor_line: '7', match_key: '"format"', verdict: 'harmless',
        rationale: 'The reviewer judged the format step optional in the source context, so a stale warning would mislead.',
      });
    }
  }
  return rows;
}

function writeSubmission(ws, reviewer, rows, inputs) {
  const dir = join(ws, 'submissions', reviewer);
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, 'labels.tsv'), lib.toTsv(lib.LABEL_COLUMNS, rows));
  const docs = new Set(lib.instructionPaths(inputs).map((d) => `${d.repo}\t${d.path}`));
  const claims = lib.loadClaims();
  const counts = new Map();
  for (const row of rows) {
    const key = coverageKey(row, docs, claims);
    const c = counts.get(key) ?? { total: 0, positives: 0 };
    c.total += 1;
    c.positives += lib.POSITIVE_VERDICTS.has(row.verdict) ? 1 : 0;
    counts.set(key, c);
  }
  const log = lib.parseTsv(coverageTemplate(inputs)).rows.map((r) => {
    const c = counts.get(`${r.repo}\t${r.instruction_path}\t${r.claim_family}`) ?? { total: 0, positives: 0 };
    return { ...r, status: 'swept', opportunities: c.total, positives: c.positives };
  });
  writeFileSync(join(dir, 'coverage-log.tsv'), lib.toTsv(lib.COVERAGE_COLUMNS, log));
  writeFileSync(join(dir, 'attestation.md'), readFileSync(join(real, 'templates', 'attestation.md'), 'utf8').replaceAll('[ ]', '[x]'));
}

function prepare(name, variant) {
  const world = buildWorld(name, variant);
  assert.equal(verifyInputs({ holdoutDir: holdout }).checks.filter((c) => !c.ok).length, 0, 'synthetic reservation verifies');
  materialize({ out: join(world.ws, 'materialized'), remoteBase: world.remotes });
  const r1 = labelsFor(world.inputs, 'R1', variant);
  const r2 = labelsFor(world.inputs, 'R2', variant);
  writeSubmission(world.ws, 'R1', r1, world.inputs);
  writeSubmission(world.ws, 'R2', r2, world.inputs);
  const adjudicated = r1.map((row, i) => ({
    ...row, r1_opportunity_id: row.opportunity_id, r1_verdict: row.verdict, r2_opportunity_id: r2[i].opportunity_id, r2_verdict: r2[i].verdict,
    disagreement: 'none', adjudication_rationale: 'Both reviewers agreed on every field.',
  }));
  mkdirSync(join(world.ws, 'adjudication'), { recursive: true });
  writeFileSync(join(world.ws, 'adjudication', 'adjudicated.tsv'), lib.toTsv(lib.ADJUDICATION_COLUMNS, adjudicated));
  return world;
}

const profile = { runs: 7, summary: [{ repository: 'alpha', baseline: { medianMilliseconds: 100, medianMaxRssKiB: 1000 }, candidate: { medianMilliseconds: 105, medianMaxRssKiB: 1010 } }] };
const dump = (result) => result.results.map((r) => `${r.id}: ${r.status} ${r.x ?? ''}/${r.n ?? ''} bound ${r.bound?.toFixed(3) ?? '-'} ${r.detail ?? ''}`).join('\n');
const status = (result, id) => {
  const found = result.results.find((r) => r.id === id);
  assert.ok(found, `gate ${id} missing:\n${dump(result)}`);
  return found.status;
};

test('materialize writes raw read-only snapshots that match their pinned listing', { skip: !gitAvailable }, () => {
  const world = buildWorld('materialize', 'clean');
  const records = materialize({ out: join(world.ws, 'materialized'), remoteBase: world.remotes });
  assert.equal(records.length, 3);
  const slug = 'acme--alpha';
  const snapshot = join(world.ws, 'materialized', 'snapshots', slug);
  const listing = lib.parseTsv(readFileSync(join(world.ws, 'materialized', 'listings', `${slug}.tsv`), 'utf8')).rows;
  assert.equal(snapshotDifferences(snapshot, listing), 0);
  assert.throws(() => writeFileSync(join(snapshot, 'AGENTS.md'), 'changed'), /EACCES|EPERM/);
  unlock(snapshot);
  writeFileSync(join(snapshot, 'AGENTS.md'), 'changed');
  assert.equal(snapshotDifferences(snapshot, listing), 1);
  assert.throws(() => materialize({ out: join(world.ws, 'materialized'), remoteBase: world.remotes }), /already exists/);
});

test('review packages carry identical material and nothing from the other reviewer', { skip: !gitAvailable }, () => {
  const world = prepare('packages', 'clean');
  const a = buildPackage({ workspace: world.ws, materialized: join(world.ws, 'materialized'), reviewer: 'R1' });
  const b = buildPackage({ workspace: world.ws, materialized: join(world.ws, 'materialized'), reviewer: 'R2' });
  assert.equal(a.commonDigest, b.commonDigest);
  const names = readdirSync(a.out).sort();
  assert.deepEqual(names, readdirSync(b.out).sort());
  assert.equal(readFileSync(join(a.out, 'labels.tsv'), 'utf8').trim().split('\n').length, 1, 'blank label file');
  assert.ok(!names.includes('adjudicated.tsv') && !names.includes('submissions'), 'no adjudication or submission material');
  assert.throws(() => buildPackage({ workspace: world.ws, materialized: join(world.ws, 'materialized'), reviewer: 'R1' }), /already exists/);
  assert.throws(() => buildPackage({ workspace: world.ws, materialized: join(world.ws, 'materialized'), reviewer: 'R3' }), /R1 or R2/);
});

test('lock, single run, audit and scoring: a clean pipeline reaches a scoped decision', { skip: !gitAvailable }, () => {
  const world = prepare('clean', 'clean');
  assert.throws(() => createLock(world.ws, { engine: ENGINE }), /Categories below/, 'unvalidated categories block the lock by default');
  const lock = createLock(world.ws, { engine: ENGINE, allowUnvalidatedCategories: true });
  assert.deepEqual(lock.unvalidatedCategories, ['missing', 'conflict', 'unsafe', 'scan']);
  assert.equal(lock.coverage.overall.validated, true);
  assert.throws(() => createLock(world.ws, { engine: ENGINE, allowUnvalidatedCategories: true }), /already locked/);

  const record = execute(world.ws, { engine: ENGINE });
  assert.deepEqual(record.summary, { credentialValues: 0, nonAsciiBytes: 0, snapshotModifications: 0, nonDeterministic: 0, failures: 0 });
  assert.equal(record.repositories.length, 3);
  assert.throws(() => execute(world.ws, { engine: ENGINE }), /already run/, 'the candidate runs once');

  assert.equal(makeAudit(world.ws, { engine: ENGINE }), 0, 'every finding matched a label');
  const result = evaluate(world.ws, { engine: ENGINE, profilePath: (() => { const p = join(world.ws, 'profile.json'); writeFileSync(p, JSON.stringify(profile)); return p; })() });
  assert.equal(status(result, 'overall.defectPrecision'), 'pass', dump(result));
  assert.equal(status(result, 'overall.defectRecall'), 'pass', dump(result));
  assert.equal(status(result, 'overall.falsePositiveRate'), 'pass', dump(result));
  assert.equal(status(result, 'overall.cueFactualAccuracy'), 'pass', dump(result));
  assert.equal(status(result, 'overall.evidenceCorrectness'), 'pass', dump(result));
  assert.equal(status(result, 'overall.leaveOneRepositoryOut'), 'pass', dump(result));
  assert.equal(status(result, 'security.errorSeverityFalsePositives'), 'not-exercised', dump(result));
  assert.equal(status(result, 'runtime.pairedProfile'), 'pass', dump(result));
  assert.equal(status(result, 'security.securityIssueRecall'), 'unvalidated', dump(result));
  assert.equal(result.decision, 'SCOPED-GO');
  assert.equal(result.table.perOpportunity.filter((o) => o.outcome === 'TP').length, 6);
  assert.equal(result.table.perOpportunity.filter((o) => o.outcome === 'TN').length, 3);

  // Tampering with any locked input after the lock stops the evaluation.
  const file = join(world.ws, 'adjudication', 'adjudicated.tsv');
  const original = readFileSync(file, 'utf8');
  writeFileSync(file, original.replace('Both reviewers agreed', 'Edited after lock'));
  assert.throws(() => verifyLock(world.ws, { engine: ENGINE }), /adjudicated\.tsv changed after the lock/);
  writeFileSync(file, original);
  assert.throws(() => verifyLock(world.ws, { engine: { ...ENGINE, src: 'other' } }), /engine changed after the lock/);
});

test('a false positive on a labeled negative fails the precision gate', { skip: !gitAvailable }, () => {
  const world = prepare('falsepositive', 'falsePositive');
  createLock(world.ws, { engine: ENGINE, allowUnvalidatedCategories: true });
  execute(world.ws, { engine: ENGINE });
  const result = evaluate(world.ws, { engine: ENGINE });
  assert.equal(status(result, 'overall.defectPrecision'), 'fail', dump(result));
  assert.match(result.decision, /^NO-GO/);
  assert.equal(result.table.perOpportunity.filter((o) => o.outcome === 'FP').length, 1);
});

test('an unlabeled finding goes to a masked audit queue and blocks the decision until audited', { skip: !gitAvailable }, () => {
  const world = prepare('unaudited', 'unaudited');
  createLock(world.ws, { engine: ENGINE, allowUnvalidatedCategories: true });
  execute(world.ws, { engine: ENGINE });
  assert.equal(makeAudit(world.ws, { engine: ENGINE }), 1);
  const queue = readFileSync(join(world.ws, 'audit', 'audit-queue.tsv'), 'utf8');
  assert.doesNotMatch(queue, /\twarning\t|\tinfo\t|\terror\t/, 'engine severity is hidden');
  const rows = lib.parseTsv(queue).rows;
  assert.equal(rows.length, 2, 'one tool finding plus one control');
  const key = JSON.parse(readFileSync(join(world.ws, 'audit', 'audit-key.json'), 'utf8'));
  const item = key.find((k) => !k.control);

  const before = evaluate(world.ws, { engine: ENGINE });
  assert.equal(status(before, 'overall.defectPrecision'), 'incomplete', dump(before));
  assert.equal(before.decision, 'INCOMPLETE');

  const labels = key.map((k) => ({
    audit_id: k.auditId, verdict: k.control ? (k.expectedPositive ? 'issue' : 'non-issue') : 'issue',
    class: k.control ? '-' : 'defect', severity: k.control ? '-' : 'warning', evidence_correct: k.control ? '-' : 'yes', rationale: 'Judged from the pinned source against the rubric.',
  }));
  writeFileSync(join(world.ws, 'audit', 'audit-adjudicated.tsv'), lib.toTsv(lib.AUDIT_LABEL_COLUMNS, labels));
  const after = evaluate(world.ws, { engine: ENGINE });
  assert.notEqual(status(after, 'overall.defectPrecision'), 'incomplete');
  assert.equal(after.controlAgreement.agreed, 1);
  assert.equal(after.table.unmatchedFindings.find((u) => u.repo === item.repo).audit, 'issue');
});

test('label validation rejects structural errors, credential-like values and dishonest coverage', () => {
  const inputs = lib.loadInputs();
  const input = inputs[0];
  const good = { ...blank, opportunity_id: 'R1-1', repo: input.repository, commit: input.commit, category: 'stale', claim_id: 'missing-script-reference', source_path: 'AGENTS.md',
    reference: 'lint', scope: 'root package', anchor_path: 'AGENTS.md', anchor_line: '5', match_key: '"lint"', verdict: 'issue', class: 'defect', severity: 'warning',
    next_action: 'Define the script or remove the instruction.', rationale: 'The guide names a script the manifest does not define.' };
  const check = (rows) => validateLabels(lib.toTsv(lib.LABEL_COLUMNS, rows), { inputs }).errors.join('\n');
  assert.equal(check([good]), '');
  assert.match(check([{ ...good, commit: 'a'.repeat(40) }]), /pinned/);
  assert.match(check([{ ...good, next_action: '-' }]), /next_action/);
  assert.match(check([{ ...good, class: 'cue', severity: 'warning' }]), /severity info/);
  assert.match(check([{ ...good, claim_id: 'agents-without-claude', class: 'defect' }]), /category|only be a cue/);
  assert.match(check([{ ...good, claim_id: 'agents-without-claude', category: 'missing' }]), /can only be a cue/);
  assert.match(check([{ ...good, verdict: 'non-issue' }]), /dash unless/);
  assert.match(check([good, { ...good, opportunity_id: 'R1-2' }]), /duplicates another/);
  const token = ['Ab12', 'Cd34', 'Ef56', 'Gh78', 'Ij90', 'Kl12', 'Mn34'].join('');
  assert.match(check([{ ...good, reference: token }]), /credential/);
  assert.match(check([{ ...good, rationale: 'short' }]), /rationale/);
  const wrong = validateLabels(lib.toTsv(lib.LABEL_COLUMNS, [good]), { inputs, coverageText: coverageTemplate(inputs), final: true }).errors;
  assert.ok(wrong.some((e) => /not swept|logs 0 opportunities|labels exist/.test(e)));
});
