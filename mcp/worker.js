import fs from 'node:fs';
import path from 'node:path';
import { parentPort, workerData } from 'node:worker_threads';
import { compileContext, diagnose, redact, scanRepository } from '../src/index.js';

const { root, identity, tool, args } = workerData;
const limits = { maxFiles: 5000, maxDepth: 20, maxFileBytes: 256 * 1024, maxTotalReadBytes: 16 * 1024 * 1024, maxDirEntries: 10000 };
const factKinds = new Set(['language', 'framework', 'source-dir', 'config', 'entrypoint', 'tool', 'package-manager']);

function checkRoot() {
  const canonical = fs.realpathSync.native(root);
  const stat = fs.statSync(canonical, { bigint: true });
  if (path.relative(root, canonical) !== '' || !stat.isDirectory() || stat.dev !== identity.dev || stat.ino !== identity.ino) {
    throw new Error('Repository unavailable');
  }
}

function evidence(items) {
  return items.slice(0, 6).map(({ path, line }) => ({ path, line }));
}

function factSummary(fact) {
  return { type: 'fact', kind: fact.kind, status: fact.status, confidence: fact.confidence,
    claim: fact.claim, evidence: evidence(fact.evidence) };
}

function run() {
  checkRoot();
  const scan = scanRepository(root, limits);
  if (path.relative(root, scan.root) !== '') throw new Error('Repository unavailable');
  const warnings = scan.diagnostics.map(({ level, code, path, line }) => ({ type: 'warning', level, code, path, line }));
  const common = {
    repository: args.repository,
    untrustedRepositoryData: true,
    coverage: { filesIndexed: scan.stats.filesIndexed, truncated: scan.stats.truncated, excluded: scan.stats.excluded },
  };
  let items;
  if (tool === 'project_scan') {
    items = [
      ...scan.facts.filter((f) => factKinds.has(f.kind)).map(factSummary),
      ...scan.documents.map(({ path, scope, sha256 }) => ({ type: 'instruction', path, scope, sha256 })),
      ...warnings,
    ];
  } else if (tool === 'context_doctor') {
    const report = diagnose(scan);
    common.summary = report.summary;
    items = report.findings.map(({ id, severity, category, title, evidence: sources }) => ({
      type: 'finding', id, severity, category, title, evidence: evidence(sources),
    }));
  } else {
    const pack = compileContext(scan, args.task, { budget: args.budgetBytes + 'b', top: args.top, maxContentFiles: 2500 });
    common.compilerBudget = pack.budget;
    common.limitations = 'Task-focused selection can omit relevant files. Instruction excerpts and script bodies are not returned.';
    items = [
      ...pack.instructions.map(({ path, startLine, endLine, sha256 }) => ({ type: 'instruction', path, startLine, endLine, sha256 })),
      ...pack.files.map(({ path, score, sha256, symbols, reasons }) => ({
        type: 'file', path, score, sha256, symbols,
        reasons: reasons.slice(0, 5).map(({ kind, points }) => ({ kind, points })),
      })),
      ...pack.facts.filter((f) => factKinds.has(f.kind)).map(factSummary),
      ...pack.omissions.map(({ kind, what, reason }) => ({ type: 'omission', kind, what, reason })),
      ...warnings,
    ];
  }
  checkRoot();
  return { common, items };
}

function clean(value) {
  // The core already neutralizes fact content. Filter again at the wire boundary
  // and remove the configured machine path even when it appears in metadata.
  if (typeof value === 'string') {
    return redact(value.split(root).join('<repository>').split(root.split(path.sep).join('/')).join('<repository>'))
      .replace(/[\x00-\x1f\x7f-\x9f\u202a-\u202e\u2066-\u2069]/g, ' ').slice(0, 512);
  }
  if (Array.isArray(value)) return value.map(clean);
  if (value && typeof value === 'object') return Object.fromEntries(Object.entries(value).map(([key, v]) => [key, clean(v)]));
  return value;
}

try {
  const { common, items } = run();
  parentPort.postMessage({ common: clean(common), items: items.slice(0, 128).map(clean), total: items.length });
} catch (error) {
  parentPort.postMessage({ error: error?.code === 'BUDGET_TOO_SMALL' ? 'Compiler budget too small.' : 'Repository analysis failed or its authorization changed.' });
}
