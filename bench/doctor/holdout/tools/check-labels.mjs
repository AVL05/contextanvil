#!/usr/bin/env node
// Validate a reviewer label file, or an adjudicated file, against the rubric schema.
//
//   node check-labels.mjs LABELS.tsv [--adjudicated] [--listings DIR] [--coverage COVERAGE.tsv] [--final]
//
// It checks structure and consistency only. It cannot judge whether a label is right. It never reads
// repository content and never prints a flagged value.
import { existsSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { redact } from '../../../../src/core/secrets.js';
import {
  ADJUDICATION_COLUMNS, CATEGORIES, CLASSES, COVERAGE_COLUMNS, LABEL_COLUMNS, NEGATIVE_VERDICTS, POSITIVE_VERDICTS,
  SEVERITIES, SWEEP_STATUSES, ToolError, VERDICTS, instructionPaths, isDash, isMain, loadClaims, loadInputs, parseTsv, readText,
} from './lib.mjs';

const ID = /^[A-Za-z0-9_-]{1,40}$/;
const HEX = /^(?:[0-9a-f]{40}|[0-9a-f]{64})$/;
const NUMBER = /^[1-9][0-9]{0,8}$/;
const longToken = /[A-Za-z0-9+_=-]{24,}/g;

function looksLikeCredential(text) {
  if (redact(text) !== text) return true;
  return (text.match(longToken) ?? []).some((token) => !HEX.test(token) && /\d/.test(token) && /[A-Za-z]/.test(token));
}

function loadListings(dir) {
  const listings = new Map();
  if (!dir || !existsSync(dir)) return listings;
  for (const name of readdirSync(dir).filter((n) => n.endsWith('.tsv'))) {
    const { rows } = parseTsv(readText(join(dir, name)));
    listings.set(name.replace(/\.tsv$/, ''), new Set(rows.map((r) => r.path)));
  }
  return listings;
}

export function validateLabels(text, { adjudicated = false, listingsDir, coverageText, final = false, inputs = loadInputs() } = {}) {
  const errors = [];
  const claims = loadClaims();
  const columns = adjudicated ? ADJUDICATION_COLUMNS : LABEL_COLUMNS;
  let parsed;
  try { parsed = parseTsv(text); } catch (error) { return { errors: [error.message], rows: [] }; }
  if (parsed.header.join('\t') !== columns.join('\t')) {
    return { errors: [`Header must be exactly: ${columns.join(' | ')}`], rows: [] };
  }
  const pinned = new Map(inputs.map((r) => [r.repository, r]));
  const listings = loadListings(listingsDir);
  const seen = new Set();
  const identities = new Set();
  const err = (row, message) => errors.push(`line ${row._line}: ${message}`);

  for (const row of parsed.rows) {
    for (const column of columns) {
      const value = row[column];
      if (value === '') err(row, `${column} is empty. Use a dash for not applicable.`);
      if (/[\u0000-\u0008\u000b-\u001f\u007f]/.test(value)) err(row, `${column} contains a control character`);
      if (looksLikeCredential(value)) err(row, `${column} looks like a credential value. Describe it, never copy it.`);
    }
    if (!ID.test(row.opportunity_id)) err(row, 'opportunity_id must be 1-40 letters, digits, dash or underscore');
    if (seen.has(row.opportunity_id)) err(row, `duplicate opportunity_id ${row.opportunity_id}`);
    seen.add(row.opportunity_id);

    const repo = pinned.get(row.repo);
    if (!repo) err(row, `repo ${row.repo} is not in the reservation`);
    else if (row.commit !== repo.commit) err(row, `commit must be the pinned ${repo.commit}`);
    if (!CATEGORIES.includes(row.category)) err(row, `category must be one of ${CATEGORIES.join(', ')}`);
    if (!VERDICTS.includes(row.verdict)) err(row, `verdict must be one of ${VERDICTS.join(', ')}`);

    const claim = claims.get(row.claim_id);
    if (row.verdict === 'unsupported') {
      if (!/^unsupported:[a-z0-9][a-z0-9-]{2,60}$/.test(row.claim_id)) err(row, 'unsupported cases use claim_id unsupported:<short-slug>');
    } else if (!claim) err(row, `claim_id ${row.claim_id} is not in claims.tsv`);
    else if (claim.category !== row.category) err(row, `claim ${row.claim_id} belongs to category ${claim.category}`);

    for (const [column, lineColumn] of [['source_path', 'source_line'], ['anchor_path', 'anchor_line']]) {
      if (!isDash(row[lineColumn]) && !NUMBER.test(row[lineColumn])) err(row, `${lineColumn} must be a positive integer or a dash`);
      if (!isDash(row[lineColumn]) && isDash(row[column])) err(row, `${lineColumn} needs ${column}`);
      const known = listings.get(String(row.repo).replace('/', '--'));
      if (!isDash(row[column]) && known && !known.has(row[column])) err(row, `${column} ${row[column]} is not in the pinned tree listing`);
    }

    const positive = POSITIVE_VERDICTS.has(row.verdict);
    if (row.rationale.length < 20) err(row, 'rationale needs at least 20 characters of reasoning');
    if (positive) {
      if (!CLASSES.includes(row.class)) err(row, `class must be ${CLASSES.join(' or ')} for a positive`);
      if (!SEVERITIES.includes(row.severity)) err(row, `severity must be ${SEVERITIES.join(', ')} for a positive`);
      if (row.class === 'cue' && row.severity !== 'info') err(row, 'a review cue has severity info');
      if (row.class === 'defect' && row.severity === 'info') err(row, 'a confirmed defect has severity warning or error');
      if (row.class === 'defect' && claim?.nature === 'cue-only') err(row, `${row.claim_id} can only be a cue`);
      if (row.class === 'defect' && (isDash(row.next_action) || row.next_action.length < 10)) err(row, 'a confirmed defect needs a concrete next_action');
      if (claim?.scope === 'document' && isDash(row.anchor_path)) err(row, 'a document-scope positive needs anchor_path');
      if (row.verdict === 'security-issue' && !['unsafe', 'scan'].includes(row.category)) err(row, 'security-issue belongs to unsafe or scan');
    } else {
      for (const column of ['class', 'severity', 'next_action']) {
        if (!isDash(row[column])) err(row, `${column} must be a dash unless the verdict is issue or security-issue`);
      }
      if (NEGATIVE_VERDICTS.has(row.verdict) && isDash(row.source_path) && isDash(row.scope)) {
        err(row, 'a negative opportunity needs source_path or scope so that it can be located');
      }
    }
    const key = [row.repo, row.claim_id, row.source_path, row.source_line, row.reference, row.anchor_path, row.anchor_line].join('|');
    if (identities.has(key)) err(row, 'duplicates another opportunity with the same claim, location and reference');
    identities.add(key);
    if (adjudicated && isDash(row.adjudication_rationale)) err(row, 'adjudication_rationale is required');
  }

  if (coverageText) errors.push(...validateCoverage(parsed.rows, coverageText, { final, inputs }));
  else if (final) errors.push('--final needs --coverage COVERAGE.tsv');
  return { errors, rows: parsed.rows };
}

export function coverageKey(row, docs, claims) {
  const claim = claims.get(row.claim_id);
  const document = claim?.scope === 'document' && docs.has(`${row.repo}\t${row.source_path}`);
  return `${row.repo}\t${document ? row.source_path : '-'}\t${row.category}`;
}

export function validateCoverage(labelRows, coverageText, { final, inputs }) {
  const errors = [];
  const claims = loadClaims();
  let parsed;
  try { parsed = parseTsv(coverageText); } catch (error) { return [`coverage: ${error.message}`]; }
  if (parsed.header.join('\t') !== COVERAGE_COLUMNS.join('\t')) return [`coverage header must be: ${COVERAGE_COLUMNS.join(' | ')}`];
  const docs = new Set(instructionPaths(inputs).map((d) => `${d.repo}\t${d.path}`));
  const counts = new Map();
  for (const row of labelRows) {
    const key = coverageKey(row, docs, claims);
    const entry = counts.get(key) ?? { total: 0, positives: 0 };
    entry.total += 1;
    if (POSITIVE_VERDICTS.has(row.verdict)) entry.positives += 1;
    counts.set(key, entry);
  }
  const expected = new Set();
  for (const repo of inputs) for (const category of CATEGORIES) expected.add(`${repo.repository}\t-\t${category}`);
  for (const doc of docs) for (const category of CATEGORIES) expected.add(`${doc}\t${category}`);
  const logged = new Set();
  for (const row of parsed.rows) {
    const key = `${row.repo}\t${row.instruction_path}\t${row.claim_family}`;
    if (!expected.has(key)) { errors.push(`coverage line ${row._line}: ${row.repo} ${row.instruction_path} ${row.claim_family} is not a required sweep`); continue; }
    logged.add(key);
    if (!SWEEP_STATUSES.includes(row.status)) errors.push(`coverage line ${row._line}: status must be ${SWEEP_STATUSES.join(' or ')}`);
    const actual = counts.get(key) ?? { total: 0, positives: 0 };
    if (row.status === 'swept') {
      if (Number(row.opportunities) !== actual.total) errors.push(`coverage line ${row._line}: logs ${row.opportunities} opportunities but the labels hold ${actual.total}`);
      if (Number(row.positives) !== actual.positives) errors.push(`coverage line ${row._line}: logs ${row.positives} positives but the labels hold ${actual.positives}`);
    } else if (actual.total) errors.push(`coverage line ${row._line}: not-swept but ${actual.total} labels exist for it`);
    if (final && row.status !== 'swept') errors.push(`coverage line ${row._line}: ${key.replace(/\t/g, ' ')} is not swept`);
  }
  for (const key of expected) if (!logged.has(key)) errors.push(`coverage is missing the sweep ${key.replace(/\t/g, ' ')}`);
  return errors;
}

if (isMain(import.meta.url)) {
  const args = process.argv.slice(2);
  const value = (flag) => (args.includes(flag) ? args[args.indexOf(flag) + 1] : undefined);
  try {
    const file = args.find((a) => !a.startsWith('--') && ![value('--listings'), value('--coverage')].includes(a));
    if (!file) throw new ToolError('Usage: node check-labels.mjs LABELS.tsv [--adjudicated] [--listings DIR] [--coverage FILE] [--final]');
    const { errors, rows } = validateLabels(readText(file), {
      adjudicated: args.includes('--adjudicated'), listingsDir: value('--listings'),
      coverageText: value('--coverage') ? readText(value('--coverage')) : undefined, final: args.includes('--final'),
    });
    for (const message of errors.slice(0, 100)) console.error(message);
    if (errors.length > 100) console.error(`... and ${errors.length - 100} more`);
    console.log(errors.length ? `${errors.length} problem(s) in ${rows.length} rows.` : `OK: ${rows.length} rows.`);
    process.exitCode = errors.length ? 1 : 0;
  } catch (error) {
    if (!(error instanceof ToolError)) throw error;
    console.error(error.message);
    process.exitCode = 2;
  }
}
