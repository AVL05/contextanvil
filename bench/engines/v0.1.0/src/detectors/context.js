import { createFact } from '../core/facts.js';

/** Strip comments and trailing commas so tsconfig-style JSONC can be parsed with JSON.parse. */
export function stripJsonc(text) {
  let out = '';
  let i = 0;
  while (i < text.length) {
    const c = text[i];
    const next = text[i + 1];
    if (c === '"') {
      let j = i + 1;
      while (j < text.length && text[j] !== '"') j += text[j] === '\\' ? 2 : 1;
      out += text.slice(i, j + 1);
      i = j + 1;
    } else if (c === '/' && next === '/') {
      while (i < text.length && text[i] !== '\n') i++;
    } else if (c === '/' && next === '*') {
      const end = text.indexOf('*/', i + 2);
      i = end === -1 ? text.length : end + 2;
    } else {
      out += c;
      i++;
    }
  }
  return out.replace(/,(\s*[}\]])/g, '$1');
}

function lineFromParseError(message, text) {
  const direct = /line (\d+)/.exec(message);
  if (direct) return Number(direct[1]);
  const pos = /position (\d+)/.exec(message);
  if (pos) return text.slice(0, Number(pos[1])).split('\n').length;
  return undefined;
}

/**
 * The object handed to every detector. Detectors only read through it and
 * only add facts, documents and diagnostics. They never touch the filesystem.
 */
export function createDetectorContext({ root, files, reader, diagnostics }) {
  const facts = [];
  const documents = [];
  const shared = new Map();
  const jsonCache = new Map();
  const byPath = new Map(files.map((f) => [f.path, f]));

  function parseJson(rel, { jsonc }) {
    const cacheKey = `${jsonc ? 'c' : 'j'}:${rel}`;
    if (jsonCache.has(cacheKey)) return jsonCache.get(cacheKey);
    let value;
    const text = reader.read(rel);
    if (text !== null) {
      try {
        value = JSON.parse(jsonc ? stripJsonc(text) : text);
      } catch (err) {
        const line = lineFromParseError(String(err.message), text);
        // Node's parse errors quote file content; report only the location.
        diagnostics.push({
          level: 'warn',
          code: 'malformed-json',
          message: `Could not parse ${rel} as ${jsonc ? 'JSON with comments' : 'JSON'}${line ? ` (near line ${line})` : ''}`,
          path: rel,
          ...(line ? { line } : {}),
        });
        value = undefined;
      }
    }
    jsonCache.set(cacheKey, value);
    return value;
  }

  const ctx = {
    root,
    files,
    facts,
    documents,
    shared,
    has: (rel) => byPath.has(rel),
    entry: (rel) => byPath.get(rel),
    find: (predicate) => files.filter((f) => predicate(f.path, f)),
    read: (rel) => reader.read(rel),
    /** { text, bytes, sha256 } or null. */
    meta: (rel) => reader.readMeta(rel),
    readJson: (rel) => parseJson(rel, { jsonc: false }),
    readJsonc: (rel) => parseJson(rel, { jsonc: true }),
    diag(level, code, message, path, extra = {}) {
      diagnostics.push({ level, code, message, ...(path ? { path } : {}), ...extra });
    },

    /** 1-based line of the first line matching a string or RegExp, or undefined. */
    lineOf(rel, pattern) {
      const text = reader.read(rel);
      if (text === null) return undefined;
      const all = text.split(/\r?\n/);
      const test = pattern instanceof RegExp ? (s) => pattern.test(s) : (s) => s.includes(pattern);
      const i = all.findIndex(test);
      return i === -1 ? undefined : i + 1;
    },

    /** Approximate line of a nested JSON key path, e.g. jsonLine('package.json', 'dependencies', 'react'). */
    jsonLine(rel, ...keys) {
      const text = reader.read(rel);
      if (text === null) return undefined;
      const all = text.split(/\r?\n/);
      let start = 0;
      let found;
      for (const key of keys) {
        const re = new RegExp(`"${key.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}"\\s*:`);
        const i = all.findIndex((s, idx) => idx >= start && re.test(s));
        if (i === -1) return found;
        found = i + 1;
        start = i;
      }
      return found;
    },

    /** Create a fact, attach freshness from its primary source, and record it. */
    addFact(spec) {
      const primary = spec.evidence?.[0]?.path;
      let freshness = null;
      if (primary && byPath.has(primary)) {
        const meta = reader.readMeta(primary);
        if (meta) freshness = { sha256: meta.sha256.slice(0, 16), bytes: meta.bytes };
      }
      const fact = createFact({ ...spec, freshness });
      if (!facts.some((f) => f.id === fact.id)) facts.push(fact);
      return fact;
    },
  };
  return ctx;
}
