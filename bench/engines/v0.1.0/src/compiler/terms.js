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
 * @returns {'exact'|'prefix'|null}
 */
export function matchTerm(term, token) {
  const t = stem(token);
  if (t === term) return 'exact';
  const [short, long] = t.length <= term.length ? [t, term] : [term, t];
  if (short.length >= 3 && long.startsWith(short)) return 'prefix';
  return null;
}
