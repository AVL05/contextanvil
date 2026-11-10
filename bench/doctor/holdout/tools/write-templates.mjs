#!/usr/bin/env node
// Regenerate the blank TSV templates from the schema in lib.mjs, so schema and templates cannot drift.
// test/holdout-tools.test.js fails when the committed templates differ from this output.
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  ADJUDICATION_COLUMNS, AUDIT_COLUMNS, AUDIT_LABEL_COLUMNS, HOLDOUT_DIR, LABEL_COLUMNS, isMain, loadInputs, toTsv,
} from './lib.mjs';
import { coverageTemplate } from './package.mjs';

export function templates() {
  return {
    'labels.tsv': toTsv(LABEL_COLUMNS, []),
    'adjudication.tsv': toTsv(ADJUDICATION_COLUMNS, []),
    'audit-queue.tsv': toTsv(AUDIT_COLUMNS, []),
    'audit-labels.tsv': toTsv(AUDIT_LABEL_COLUMNS, []),
    'coverage-log.tsv': coverageTemplate(loadInputs()),
  };
}

if (isMain(import.meta.url)) {
  const dir = join(HOLDOUT_DIR, 'templates');
  mkdirSync(dir, { recursive: true });
  for (const [name, text] of Object.entries(templates())) writeFileSync(join(dir, name), text);
  console.log(`Wrote ${Object.keys(templates()).length} templates to ${dir}`);
}
