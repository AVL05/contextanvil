#!/usr/bin/env node
// Custodian tool: score the one locked run against the adjudicated labels and the pre-registered gates.
//
//   node evaluate.mjs --workspace DIR --make-audit
//       Writes audit/audit-queue.tsv (unmatched findings, shuffled, engine severity hidden) and the
//       custodian-only audit/audit-key.json. Two reviewers label the queue independently, the custodian
//       adjudicates it into audit/audit-adjudicated.tsv.
//   node evaluate.mjs --workspace DIR [--profile profile.json]
//       Scores the run. Writes result/result.json and prints a summary.
//
// The lock is re-verified first, so a changed engine, label, rule or gate stops the evaluation.
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  AUDIT_COLUMNS, AUDIT_LABEL_COLUMNS, HOLDOUT_DIR, ToolError, fail, isMain, loadClaims, loadIdentities, loadInputs, parseTsv, readText, toTsv, byCodeUnit, sha256,
} from './lib.mjs';
import { assign, auditId, evaluateGates, judgeFindings } from './score.mjs';
import { verifyLock, workspacePaths } from './seal.mjs';

function loadRun(paths, inputs) {
  const reports = new Map();
  for (const input of inputs) {
    const file = join(paths.runs, 'reports', `${input.repository.replace('/', '--')}.json`);
    if (!existsSync(file)) fail(`No report for ${input.repository}. The run is incomplete.`);
    reports.set(input.repository, JSON.parse(readFileSync(file, 'utf8')));
  }
  return reports;
}

export function makeAudit(workspace, options = {}) {
  const paths = workspacePaths(workspace);
  verifyLock(workspace, options);
  const inputs = loadInputs();
  const assignment = assign(parseTsv(readText(paths.adjudicated)).rows, loadRun(paths, inputs));
  const claims = loadClaims();
  const items = assignment.unmatched.map((u) => ({ id: auditId(u.repo, u.index), ...u }));
  items.sort((a, b) => byCodeUnit(a.id, b.id));
  mkdirSync(paths.audit, { recursive: true });
  const rows = items.map((i) => {
    const evidence = i.finding.evidence?.[0];
    return {
      audit_id: i.id, repo: i.repo, category: i.finding.category, claim_id: i.finding.id,
      path: evidence?.path ?? '-', line: evidence?.line ?? '-', claim_text: `${claims.get(i.finding.id)?.claim ?? ''} ${i.finding.title}`.trim(),
    };
  });
  // Control items come from the locked labels, so reviewers cannot tell tool findings from controls.
  const controls = assignment.opportunities.filter((o) => ['issue', 'security-issue', 'harmless', 'non-issue'].includes(o.verdict))
    .sort((x, y) => byCodeUnit(sha256(x.opportunity_id), sha256(y.opportunity_id))).slice(0, items.length);
  const key = items.map((i) => ({ auditId: i.id, repo: i.repo, index: i.index, control: false }));
  for (const o of controls) {
    const id = `A${sha256(`control#${o.opportunity_id}`).slice(0, 12)}`;
    rows.push({
      audit_id: id, repo: o.repo, category: o.category, claim_id: o.claim_id, path: o.anchor_path, line: o.anchor_line,
      claim_text: `${claims.get(o.claim_id)?.claim ?? ''} ${o.reference === '-' ? '' : o.reference}`.trim(),
    });
    key.push({ auditId: id, control: true, expectedPositive: ['issue', 'security-issue'].includes(o.verdict) });
  }
  rows.sort((x, y) => byCodeUnit(x.audit_id, y.audit_id));
  writeFileSync(join(paths.audit, 'audit-queue.tsv'), toTsv(AUDIT_COLUMNS, rows));
  writeFileSync(join(paths.audit, 'audit-key.json'), `${JSON.stringify(key, null, 2)}\n`);
  return items.length;
}

export function evaluate(workspace, { profilePath, engine } = {}) {
  const paths = workspacePaths(workspace);
  const lock = verifyLock(workspace, engine ? { engine } : {});
  const inputs = loadInputs();
  const identities = loadIdentities();
  const gates = JSON.parse(readText(join(HOLDOUT_DIR, 'gates.json')));
  const rows = parseTsv(readText(paths.adjudicated)).rows;
  const record = JSON.parse(readText(join(paths.runs, 'run-record.json')));
  const assignment = assign(rows, loadRun(paths, inputs));
  const listings = new Map(inputs.map((i) => [i.repository, new Set(parseTsv(readText(join(paths.materialized, 'listings', `${i.repository.replace('/', '--')}.tsv`))).rows.map((r) => r.path))]));

  const auditLabels = new Map();
  const auditFile = join(paths.audit, 'audit-adjudicated.tsv');
  if (existsSync(auditFile)) {
    const parsed = parseTsv(readText(auditFile));
    if (parsed.header.join('\t') !== AUDIT_LABEL_COLUMNS.join('\t')) fail(`audit-adjudicated.tsv header must be ${AUDIT_LABEL_COLUMNS.join(' | ')}`);
    for (const row of parsed.rows) auditLabels.set(row.audit_id, row);
  }
  const judged = judgeFindings(assignment, auditLabels, listings);
  const keyFile = join(paths.audit, 'audit-key.json');
  const controls = existsSync(keyFile) ? JSON.parse(readText(keyFile)).filter((k) => k.control) : [];
  const answered = controls.filter((k) => auditLabels.has(k.auditId));
  const controlAgreement = {
    answered: answered.length, total: controls.length,
    agreed: answered.filter((k) => ['issue', 'security-issue'].includes(auditLabels.get(k.auditId).verdict) === k.expectedPositive).length,
  };

  const reviewFile = join(paths.runs, 'leak-review.json');
  const review = existsSync(reviewFile) ? JSON.parse(readText(reviewFile)) : {};
  const suspects = record.repositories.flatMap((r) => r.leakSuspects);
  const unresolvedLeaks = suspects.filter((s) => review[s] !== 'benign').length;
  const runSummary = { ...record.summary, credentialValues: unresolvedLeaks };

  const profile = profilePath ? JSON.parse(readText(profilePath)) : null;
  const docsSwept = lock.coverage.overall.documentsSwept;
  const evaluation = evaluateGates({ rows, identities, gates, assignment, judged, runSummary, profile, docsSwept });
  const table = {
    perOpportunity: assignment.opportunities.map((o) => ({ id: o.opportunity_id, repo: o.repo, claim: o.claim_id, verdict: o.verdict, class: o.class, outcome: o.verdict === 'ambiguous' || o.verdict === 'unsupported' ? o.verdict : (o.verdict === 'issue' || o.verdict === 'security-issue') ? (o.finding ? 'TP' : 'FN') : (o.finding ? 'FP' : 'TN'), finding: o.findingIndex || null })),
    unmatchedFindings: assignment.unmatched.map((u) => ({ repo: u.repo, index: u.index, id: u.finding.id, severity: u.finding.severity, audit: auditLabels.get(auditId(u.repo, u.index))?.verdict ?? 'pending' })),
    duplicates: assignment.duplicates.map((d) => ({ repo: d.repo, index: d.index, of: d.of })),
  };
  mkdirSync(paths.result, { recursive: true });
  const result = { controlAgreement, lockEngine: lock.engine, runRecordSummary: record.summary, node: record.node, os: record.os, ...evaluation, table };
  writeFileSync(join(paths.result, 'result.json'), `${JSON.stringify(result, null, 2)}\n`);
  return result;
}

if (isMain(import.meta.url)) {
  const args = process.argv.slice(2);
  const value = (flag) => (args.includes(flag) ? args[args.indexOf(flag) + 1] : undefined);
  try {
    if (!value('--workspace')) fail('Usage: node evaluate.mjs --workspace DIR [--make-audit | --profile FILE]');
    if (args.includes('--make-audit')) {
      console.log(`${makeAudit(value('--workspace'))} unmatched findings written to the audit queue.`);
    } else {
      const result = evaluate(value('--workspace'), { profilePath: value('--profile') });
      for (const r of result.results) {
        const stats = r.n !== undefined && r.x !== undefined ? ` ${r.x}/${r.n}` : '';
        const bound = r.bound !== undefined ? ` bound ${r.bound.toFixed(3)} vs ${r.limit}` : '';
        console.log(`${r.status.toUpperCase().padEnd(13)} ${r.id}${stats}${bound}${r.detail ? `  (${r.detail})` : ''}`);
      }
      console.log(`\nDecision: ${result.decision}. Unvalidated categories: ${result.unvalidatedCategories.join(', ') || 'none'}.`);
    }
  } catch (error) {
    if (!(error instanceof ToolError)) throw error;
    console.error(error.message);
    process.exitCode = 2;
  }
}
