import assert from 'node:assert/strict';
import fs from 'node:fs';
import { test } from 'node:test';
import * as api from '../src/index.js';
import { PACK_SCHEMA_VERSION, SCAN_SCHEMA_VERSION } from '../src/index.js';
import { fixture, REPO_ROOT } from './helpers.js';
import path from 'node:path';

test('public API surface is exactly the documented set', () => {
  assert.deepEqual(Object.keys(api).sort(), [
    'ContextAnvilError', 'DEFAULT_LIMITS', 'DOCTOR_SCHEMA_VERSION', 'EXIT', 'PACK_SCHEMA_VERSION', 'SCAN_SCHEMA_VERSION', 'VERSION',
    'compileContext', 'diagnose', 'estimateTokens', 'exceedsThreshold', 'findSecrets', 'parseBudget', 'redact', 'scanRepository',
  ]);
  assert.equal(api.VERSION, JSON.parse(fs.readFileSync(path.join(REPO_ROOT, 'package.json'), 'utf8')).version);
  assert.deepEqual(api.EXIT, { OK: 0, FINDINGS: 1, USAGE: 2, RUNTIME: 3 });
});

test('scan result contract (schema version 1)', () => {
  const scan = api.scanRepository(fixture('next-app'));
  assert.equal(scan.schemaVersion, SCAN_SCHEMA_VERSION);
  assert.deepEqual(Object.keys(scan).sort(), ['diagnostics', 'documents', 'facts', 'files', 'limits', 'root', 'schemaVersion', 'sensitiveFiles', 'stats', 'tool']);
  assert.deepEqual(Object.keys(scan.facts[0]).sort(), ['claim', 'confidence', 'data', 'evidence', 'freshness', 'id', 'kind', 'source', 'status']);
  assert.ok(scan.facts.every((f) => ['observed', 'inferred'].includes(f.status) && ['high', 'medium', 'low'].includes(f.confidence)));
  assert.ok(scan.facts.every((f) => f.evidence.length > 0 && f.source === f.evidence[0].path), 'every fact cites a source');
  assert.equal(Object.keys(scan).includes('reader'), false, 'the reader is not part of the serialisable data');
  assert.deepEqual(Object.keys(scan.documents[0]).sort(), ['bytes', 'estimatedTokens', 'headings', 'hiddenCharacters', 'lines', 'path', 'scope', 'secretFindings', 'sections', 'sha256', 'symlinkTo', 'text', 'type']);
});

test('pack and report contracts', () => {
  const scan = api.scanRepository(fixture('next-app'));
  const pack = api.compileContext(scan, 'Update the navigation component');
  assert.equal(pack.schemaVersion, PACK_SCHEMA_VERSION);
  assert.deepEqual(Object.keys(pack).sort(), ['budget', 'facts', 'files', 'instructions', 'omissions', 'recommendations', 'rendered', 'root', 'schemaVersion', 'task', 'tool']);
  assert.deepEqual(Object.keys(pack.budget).sort(), ['limitBytes', 'tokenEstimate', 'unit', 'usedBytes', 'usedEstimatedTokens']);
  assert.deepEqual(Object.keys(pack.task).sort(), ['intent', 'mentionedPaths', 'termWeights', 'terms', 'text', 'truncated']);
  assert.deepEqual(Object.keys(pack.files[0]).sort(), ['category', 'path', 'reasons', 'related', 'score', 'sha256', 'size', 'symbols']);
  const report = api.diagnose(scan);
  assert.equal(report.schemaVersion, api.DOCTOR_SCHEMA_VERSION);
  assert.deepEqual(Object.keys(report).sort(), ['findings', 'root', 'schemaVersion', 'summary', 'tool']);
  assert.deepEqual(Object.keys(report.findings[0]).filter((k) => k !== 'recommendation').sort(), ['category', 'detail', 'evidence', 'id', 'severity', 'title']);
});

test('results are plain JSON: a scan survives a round trip and still compiles and diagnoses identically', () => {
  const scan = api.scanRepository(fixture('laravel-app'));
  const copy = JSON.parse(JSON.stringify(scan));
  assert.equal(api.compileContext(copy, 'add a field to the user controller').rendered, api.compileContext(scan, 'add a field to the user controller').rendered);
  assert.deepEqual(api.diagnose(copy), api.diagnose(scan));
});

test('errors are ContextAnvilError with stable codes and exit codes', () => {
  const cases = [
    [() => api.scanRepository(path.join(REPO_ROOT, 'nope')), 'ROOT_NOT_FOUND', 3],
    [() => api.scanRepository('.', { maxFiles: -1 }), 'INVALID_LIMIT', 2],
    [() => api.compileContext(api.scanRepository(fixture('node-lib')), ''), 'EMPTY_TASK', 2],
    [() => api.parseBudget('lots'), 'INVALID_BUDGET', 2],
  ];
  for (const [fn, code, exitCode] of cases) {
    assert.throws(fn, (err) => err instanceof api.ContextAnvilError && err.code === code && err.exitCode === exitCode, code);
  }
});

test('the API works without a TTY, environment variables or a particular working directory', () => {
  const cwd = process.cwd();
  try {
    process.chdir(path.dirname(REPO_ROOT));
    const scan = api.scanRepository(fixture('node-lib'));
    assert.ok(scan.facts.length > 0);
  } finally {
    process.chdir(cwd);
  }
});
