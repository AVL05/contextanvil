// Offline checks of the independent holdout material. Nothing here reads, materializes or scores the
// reserved repositories: only the committed reservation metadata, templates, rules and gate arithmetic.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

const holdout = fileURLToPath(new URL('../bench/doctor/holdout/', import.meta.url));
const root = fileURLToPath(new URL('../', import.meta.url));
const tools = '../bench/doctor/holdout/tools/';
const lib = await import(`${tools}lib.mjs`);
const { verifyInputs } = await import(`${tools}verify-inputs.mjs`);
const { templates } = await import(`${tools}write-templates.mjs`);
const score = await import(`${tools}score.mjs`);

test('the reserved holdout reservation is intact and has no output, label or overlap', () => {
  const result = verifyInputs();
  assert.deepEqual(result.checks.filter((c) => !c.ok), []);
  assert.equal(result.manifestSha256, '0b7c67c82d2509eb8ae779d5576b710dedca4160d39dcf7676936ea498e2147e');
});

test('identities.json records real tree ids that differ from the commit aliases in the reservation', () => {
  const inputs = lib.loadInputs();
  const identities = lib.loadIdentities();
  assert.equal(identities.length, inputs.length);
  for (const input of inputs) {
    const identity = identities.find((i) => i.repository === input.repository);
    assert.equal(identity.commit, input.commit);
    assert.match(identity.tree, /^[0-9a-f]{40}$/);
    assert.notEqual(identity.tree, input.commit, 'a tree id can never equal a commit id');
    assert.equal(identity.reservedPathsVerified, true);
  }
});

test('committed templates are generated from the schema and cannot drift', () => {
  for (const [name, text] of Object.entries(templates())) {
    assert.equal(readFileSync(join(holdout, 'templates', name), 'utf8').replace(/\r\n/g, '\n'), text, `${name} is stale. Run write-templates.mjs.`);
  }
});

test('every claim in the taxonomy is a documented Doctor finding id and every id is covered', () => {
  const coverage = readFileSync(join(root, 'docs', 'quality', 'detector-coverage.md'), 'utf8');
  const claims = lib.loadClaims();
  assert.equal(claims.size, 43);
  for (const id of claims.keys()) assert.ok(coverage.includes(`\`${id}\``), `${id} is not in detector-coverage.md`);
  for (const [, claim] of claims) assert.ok(lib.CATEGORIES.includes(claim.category));
});

test('the gate arithmetic matches the figures published in the gates document', () => {
  assert.equal(lib.zeroFailureTrials(0.8), 14);
  assert.equal(lib.zeroFailureTrials(0.5), 5);
  assert.equal(lib.zeroFailureTrials(0.9), 29);
  assert.ok(lib.lowerBound(14, 14) >= 0.8 && lib.lowerBound(13, 14) < 0.8);
  assert.ok(lib.lowerBound(5, 5) >= 0.5 && lib.lowerBound(4, 5) < 0.5);
  assert.ok(lib.upperBound(0, 29) <= 0.1 && lib.upperBound(0, 28) > 0.1);
  assert.ok(lib.lowerBound(29, 29) >= 0.9 && lib.lowerBound(28, 29) < 0.9);
  assert.equal(lib.lowerBound(0, 10), 0);
  assert.equal(lib.upperBound(10, 10), 1);
  const gates = JSON.parse(readFileSync(join(holdout, 'gates.json'), 'utf8'));
  assert.equal(gates.status, 'proposed', 'only the maintainers may set ratified, in a reviewed commit');
  assert.equal(gates.coverage.overall.minDeterminateNegatives, lib.zeroFailureTrials(1 - gates.accuracy.falsePositiveRate.ceiling));
  assert.equal(gates.coverage.overall.minDeterminateDefectPositives, lib.zeroFailureTrials(gates.accuracy.defectPrecision.floor));
  assert.equal(gates.coverage.perCategory.minDeterminateDefectPositives, lib.zeroFailureTrials(gates.accuracy.defectRecall.floor));
  assert.equal(gates.coverage.cues.minDeterminateCues, lib.zeroFailureTrials(gates.accuracy.cueFactualAccuracy.floor));
});

test('matching is exact, one finding matches one opportunity, and overlapping selectors are detected', () => {
  const o = (fields) => ({ opportunity_id: 'x', repo: 'a/b', category: 'stale', claim_id: 'missing-script-reference', match_key: '-', anchor_path: 'AGENTS.md', anchor_line: '-', verdict: 'issue', ...fields });
  const finding = { id: 'missing-script-reference', category: 'stale', title: 'AGENTS.md references script "lint" that package.json does not define', evidence: [{ path: 'AGENTS.md', line: 5 }] };
  assert.ok(score.matches(o({}), finding));
  assert.ok(score.matches(o({ match_key: '"lint"' }), finding));
  assert.ok(!score.matches(o({ match_key: '"build"' }), finding));
  assert.ok(!score.matches(o({ anchor_path: 'docs/AGENTS.md' }), finding));
  assert.ok(score.matches(o({ anchor_line: '5' }), finding));
  assert.ok(!score.matches(o({ anchor_line: '6' }), finding));
  assert.ok(score.matches(o({ anchor_line: '6', match_key: '"lint"' }), finding), 'with a key the line is assessed as evidence, not as selector');
  assert.ok(!score.matches(o({ claim_id: 'missing-path-reference' }), finding));
  assert.deepEqual(score.findOverlaps([o({ opportunity_id: 'p', match_key: '"lint"' }), o({ opportunity_id: 'q', match_key: '"build"' })]), []);
  assert.equal(score.findOverlaps([o({ opportunity_id: 'p' }), o({ opportunity_id: 'q', match_key: '"lint"' })]).length, 1);
  assert.equal(score.findOverlaps([o({ opportunity_id: 'p', anchor_line: '5' }), o({ opportunity_id: 'q', anchor_line: '5' })]).length, 1);
  assert.deepEqual(score.findOverlaps([o({ opportunity_id: 'p', anchor_line: '5' }), o({ opportunity_id: 'q', anchor_line: '6' })]), []);
  assert.throws(() => score.assign([o({ opportunity_id: 'p' }), o({ opportunity_id: 'q', match_key: '"lint"' })], new Map([['a/b', { findings: [finding] }]])), /Overlapping selectors/);
  const { duplicates } = score.assign([o({ opportunity_id: 'p', match_key: '"lint"' })], new Map([['a/b', { findings: [finding, finding] }]]));
  assert.equal(duplicates.length, 1, 'a repeated matching finding is a duplicate, not a second true positive');
});
