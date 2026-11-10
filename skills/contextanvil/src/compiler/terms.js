import { normalizeRelative } from '../core/paths.js';
import { redact } from '../core/secrets.js';

/** Generic words and task verbs carry no information about *where* to look. */
const STOPWORDS = new Set([
  'a', 'an', 'the', 'to', 'of', 'in', 'on', 'for', 'and', 'or', 'with', 'from', 'into', 'that', 'this', 'it', 'its',
  'is', 'are', 'be', 'we', 'our', 'my', 'me', 'all', 'any', 'some', 'when', 'how', 'why', 'what', 'where', 'which',
  'so', 'as', 'at', 'by', 'not', 'no', 'do', 'does', 'should', 'would', 'could', 'can', 'will', 'need', 'needs',
  'want', 'please', 'make', 'sure', 'ensure', 'also', 'then', 'than', 'but', 'if', 'else', 'new', 'existing', 'use',
  'using', 'used', 'update', 'updates', 'add', 'adds', 'fix', 'fixes', 'change', 'changes', 'modify', 'implement',
  'create', 'refactor', 'remove', 'delete', 'improve', 'write', 'support', 'handle', 'work', 'works', 'working',
  'code', 'file', 'files', 'feature', 'bug', 'issue', 'task', 'thing', 'stuff',
  'too', 'more', 'most', 'very', 'get', 'gets', 'got', 'out', 'up', 'down', 'off', 'only', 'instead', 'silently',
  'show', 'shows',
]);

export const MAX_TASK_CHARS = 2000;

/** Split identifiers like `NavBar`, `nav_bar`, `nav-bar`, `HTTPServer` into lowercase words. */
export function splitWords(text) {
  return text
    .replace(/([a-z0-9])([A-Z])/g, '$1 $2')
    .replace(/([A-Z]+)([A-Z][a-z])/g, '$1 $2')
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter(Boolean);
}

/** Very light normalisation so "components" matches "component". */
export function stem(word) {
  if (word.length > 4 && word.endsWith('ies')) return `${word.slice(0, -3)}y`;
  if (word.length > 3 && word.endsWith('s') && !word.endsWith('ss') && !word.endsWith('us')) return word.slice(0, -1);
  return word;
}

/**
 * Turn a free-text task into search terms and explicit path mentions.
 * The task is user input: it is length-limited and redacted before any echo.
 */
export function extractTaskTerms(task, fileSet) {
  const text = task.slice(0, MAX_TASK_CHARS);
  const terms = [];
  const seen = new Set();
  for (const word of splitWords(text)) {
    if (word.length < 2 || STOPWORDS.has(word) || /^\d+$/.test(word)) continue;
    const s = stem(word);
    if (STOPWORDS.has(s) || seen.has(s)) continue;
    seen.add(s);
    terms.push(s);
  }
  const mentionedPaths = [];
  for (const m of text.matchAll(/[\w@./\\-]+\.[A-Za-z0-9]{1,6}\b/g)) {
    const rel = normalizeRelative(m[0]);
    if (rel && fileSet.has(rel) && !mentionedPaths.includes(rel)) mentionedPaths.push(rel);
  }
  return { text: redact(text), truncated: task.length > MAX_TASK_CHARS, terms, mentionedPaths };
}

/**
 * How well does a search term match a token of a path, symbol or heading?
 *  exact  the same word after light stemming
 *  prefix one is a prefix of the other: either the shorter has 4+ characters, or
 *         it is a 3-character abbreviation of a word at least 2.5x longer (nav / navigation,
 *         but not app / apply)
 *  root   they share a long common beginning ("detection" / "detector")
 * @returns {'exact'|'prefix'|'root'|null}
 */
export function matchTerm(term, token) {
  const t = stem(token);
  if (t === term) return 'exact';
  const [short, long] = t.length <= term.length ? [t, term] : [term, t];
  if (long.startsWith(short) && (short.length >= 4 || (short.length === 3 && long.length >= short.length * 2.5))) return 'prefix';
  let common = 0;
  while (common < short.length && short[common] === long[common]) common++;
  if (common >= 5 && common / short.length >= 0.7) return 'root';
  return null;
}

/**
 * Text needle used to look for a term inside file contents. Long terms are cut
 * back so "detection" also finds "detect" and "detector".
 */
export function contentNeedle(term) {
  return term.length >= 8 ? term.slice(0, Math.max(5, term.length - 3)) : term;
}

/**
 * Task-intent rules. First rule whose trigger word appears in the task wins,
 * in this order. The intent only changes how much each *kind* of file counts
 * (see INTENT_WEIGHTS); it never selects files by itself.
 */
const INTENT_RULES = [
  ['docs', ['document', 'documentation', 'docs', 'doc', 'readme', 'changelog', 'comment', 'explain']],
  ['fix', ['fix', 'bug', 'broken', 'crash', 'error', 'fail', 'failing', 'failure', 'regression', 'wrong', 'incorrect', 'issue']],
  ['test', ['test', 'tests', 'testing', 'spec', 'specs', 'coverage']],
  ['refactor', ['refactor', 'rename', 'cleanup', 'extract', 'simplify', 'restructure', 'reorganize', 'deduplicate']],
  ['build', ['ci', 'pipeline', 'deploy', 'docker', 'dependency', 'dependencies', 'upgrade', 'bump', 'bundle', 'release']],
  ['add', ['add', 'create', 'implement', 'support', 'introduce', 'extend', 'enable']],
];

/** Multiplier per file category for each intent (categories: source, test, doc, config). */
export const INTENT_WEIGHTS = {
  modify: { source: 1, test: 0.7, doc: 0.8, config: 0.8 },
  add: { source: 1, test: 0.8, doc: 0.8, config: 0.8 },
  fix: { source: 1, test: 0.9, doc: 0.5, config: 0.6 },
  refactor: { source: 1, test: 0.9, doc: 0.4, config: 0.5 },
  test: { source: 1, test: 1.5, doc: 0.5, config: 0.6 },
  docs: { source: 0.7, test: 0.3, doc: 1.6, config: 0.6 },
  build: { source: 0.7, test: 0.5, doc: 0.6, config: 1.5 },
};

/** @returns {{ name: string, trigger: string|null }} */
export function classifyIntent(task) {
  const words = new Set(splitWords(task.slice(0, MAX_TASK_CHARS)));
  for (const [name, triggers] of INTENT_RULES) {
    const hit = triggers.find((w) => words.has(w));
    if (hit) return { name, trigger: hit };
  }
  return { name: 'modify', trigger: null };
}
