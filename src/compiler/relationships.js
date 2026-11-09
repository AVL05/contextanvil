import { byCodeUnit } from '../core/paths.js';

const MAX_TOKENS = 12000;
const MAX_LINKS = 64;
const MAX_EDGES = 24000;

function wordCharacter(code) {
  return (code >= 65 && code <= 90) || (code >= 97 && code <= 122)
    || (code >= 48 && code <= 57) || code === 95 || code === 36;
}

/** Scan a conservative prefix. Stop at syntax whose lexical boundaries we cannot identify. */
function tokenize(text, php) {
  const tokens = [];
  let line = 1;
  let i = 0;
  while (i < text.length && tokens.length < MAX_TOKENS) {
    const ch = text[i];
    const next = text[i + 1];
    if (ch === '\n') line++;
    if (text.charCodeAt(i) <= 32) {
      i++;
      continue;
    }
    if (ch === '/' && next === '/' || php && ch === '#' && next !== '[') {
      const end = text.indexOf('\n', i);
      i = end < 0 ? text.length : end;
      continue;
    }
    if (ch === '/' && next === '*') {
      const end = text.indexOf('*/', i + 2);
      if (end < 0) break;
      while (i < end + 2) if (text[i++] === '\n') line++;
      continue;
    }
    if (ch === '`' || !php && ch === '/' && text[i - 1] !== '<' && next !== '>'
      || php && (text.startsWith('<<<', i) || ch === '?' && next === '>')) break;
    const start = i++;
    if (ch === '"' || ch === "'") {
      let literal = true;
      while (i < text.length && text[i] !== ch && text[i] !== '\n') {
        if (text[i++] === '\\') {
          literal = false;
          if (text[i] === '\n') break;
          i++;
        }
      }
      if (text[i] !== ch) break;
      if (literal && i - start <= 300) tokens.push({ literal: text.slice(start + 1, i), line });
      else tokens.push({ line });
      i++;
      continue;
    }
    if (wordCharacter(text.charCodeAt(start)) || php && ch === '\\') {
      while (wordCharacter(text.charCodeAt(i)) || php && text[i] === '\\') i++;
    }
    tokens.push({ value: i - start <= 200 ? text.slice(start, i) : undefined, line });
  }
  return { tokens, partial: i < text.length };
}

const declarations = new Set(['function', 'class', 'const', 'let', 'var', 'interface', 'enum', 'type']);
const isWord = (value) => value && wordCharacter(value.charCodeAt(0));

export function extractRelationships(text, language, file, resolvers) {
  const php = language === 'PHP' || language === 'Blade';
  if (!php && language !== 'JavaScript' && language !== 'TypeScript') return null;
  if (language === 'Blade') return null;
  if (php && !text.trimStart().startsWith('<?php')) return null;
  const { tokens, partial } = tokenize(text, php);
  const links = [];
  const symbols = new Map();
  const bindings = new Map();
  const routeFile = file.startsWith('routes/');
  const value = (i) => tokens[i]?.value;
  const literal = (i) => tokens[i]?.literal;
  let depth = 0;
  let truncated = partial;
  let namespace = '';
  let reexports = 0;
  const seenLinks = new Set();
  const add = (target, type, i) => {
    if (!target || target === file) return;
    const key = type + ':' + target;
    if (seenLinks.has(key)) return;
    if (links.length === MAX_LINKS) {
      truncated = true;
      return;
    }
    links.push({ target, type, line: tokens[i].line });
    seenLinks.add(key);
  };
  for (let i = 0; i < tokens.length; i++) {
    const token = value(i);
    if (token === '{') depth++;
    if (token === '}') depth--;
    if (php) {
      if (depth === 0 && token === 'namespace' && value(i + 2) === ';') namespace = value(i + 1) ?? '';
      if (depth === 0 && token === 'use' && (value(i + 2) === ';' || value(i + 2) === 'as' && value(i + 4) === ';')) {
        const name = value(i + 1);
        if (!name) continue;
        const target = resolvers.fqToPath(name.startsWith('\\') ? name.slice(1) : name, true);
        if (target) bindings.set(value(i + 3) && value(i + 2) === 'as' ? value(i + 3) : name.split('\\').at(-1), target);
        add(target, 'namespace-import', i);
      }
      if (value(i + 1) === ':' && value(i + 2) === ':' && value(i + 3) === 'class') {
        const target = bindings.get(token) ?? (token && namespace ? resolvers.fqToPath(namespace + '\\' + token, true) : null);
        if (routeFile && value(i - 1) === '[' && value(i - 2) === ',' && literal(i - 3) !== undefined
          && value(i - 4) === '(' && ['get', 'post', 'put', 'patch', 'delete', 'options'].includes(value(i - 5))
          && value(i - 6) === ':' && value(i - 7) === ':' && value(i - 8) === 'Route'
          && value(i + 4) === ',' && literal(i + 5) !== undefined && value(i + 6) === ']') {
          add(target, 'route-handler', i);
          for (const segment of literal(i - 3).split('/')) {
            if (segment && [...segment].every((ch) => wordCharacter(ch.charCodeAt(0))) && symbols.size < 40) {
              symbols.set(segment, tokens[i - 3].line);
            }
          }
        }
      }
      if (token === 'new' || token === 'extends' || token === 'implements') {
        add(bindings.get(value(i + 1)), 'symbol-use', i);
      }
      if (token === 'view' && value(i + 1) === '(' && value(i - 1) === 'return' && literal(i + 2)) {
        const name = literal(i + 2);
        if ([...name].every((c) => wordCharacter(c.charCodeAt(0)) || c === '-' || c === '.')) {
          const target = 'resources/views/' + name.split('.').join('/') + '.blade.php';
          if (resolvers.has(target)) add(target, 'view', i);
        }
      }
    } else if (depth === 0 && (token === 'import' || token === 'export')) {
      let end = i + 1;
      if (literal(end) === undefined && (token === 'import' && isWord(value(end)) || ['{', '*'].includes(value(end)))) {
        while (end < i + 80 && (isWord(value(end)) || ['{', '}', '*', ','].includes(value(end)))) {
          if (value(end++) === 'from') break;
        }
      }
      const specifier = literal(end);
      if (specifier !== undefined && (value(end - 1) === 'from' || token === 'import' && end === i + 1)) {
        const target = resolvers.js(file, specifier, true);
        if (token === 'export') reexports++;
        add(target, token === 'export' ? 'reexport' : 'module-import', i);
        if (target && token === 'import') {
          for (let at = i + 1; at < end - 1; at++) {
            const name = value(at);
            if (isWord(name) && !['type', 'as', 'from'].includes(name) && value(at + 1) !== 'as') bindings.set(name, target);
          }
        }
      }
    }
    if ((php || depth === 0) && declarations.has(token) && isWord(value(i + 1)) && symbols.size < 40) {
      symbols.set(value(i + 1), tokens[i].line);
    }
    if (!php && value(i - 1) === '<' && token && token.charCodeAt(0) >= 65 && token.charCodeAt(0) <= 90) {
      add(bindings.get(token), resolvers.nextEntries.has(file) ? 'next-route-component' : 'component-use', i);
    }
  }
  return { links, symbols, barrel: reexports > 0 && symbols.size === 0, truncated };
}

const weights = {
  'route-handler': 6, 'view': 5, 'component-use': 5, 'next-route-component': 5,
  'module-import': 3, 'namespace-import': 3, 'symbol-use': 4, reexport: 2,
};

export function buildRelationships(analyses, eligible) {
  const adjacency = new Map();
  const edges = [];
  const barrels = new Set();
  const symbols = new Map();
  let truncatedFiles = 0;
  const files = [...analyses.keys()].sort(byCodeUnit);
  for (const source of files) {
    const parsed = analyses.get(source).relationships;
    if (!parsed) continue;
    if (parsed.truncated) truncatedFiles++;
    if (parsed.barrel) barrels.add(source);
    for (const [name, line] of parsed.symbols) {
      const key = name.toLowerCase();
      const posting = symbols.get(key) ?? [];
      if (posting.length < 5) posting.push({ path: source, line });
      symbols.set(key, posting);
    }
    const seen = new Set();
    for (const { target, type, line } of parsed.links) {
      const key = type + ':' + target;
      if (!eligible.has(target) || seen.has(key) || edges.length >= MAX_EDGES) continue;
      seen.add(key);
      const inferred = !['module-import', 'reexport'].includes(type);
      const edge = { source, target, type, status: inferred ? 'inferred' : 'observed', confidence: inferred ? 'medium' : 'high', evidence: { path: source, line } };
      edges.push(edge);
      for (const [from, to] of [[source, target], [target, source]]) {
        if (!adjacency.has(from)) adjacency.set(from, []);
        adjacency.get(from).push({ to, edge, weight: weights[type] });
      }
    }
  }
  for (const links of adjacency.values()) links.sort((a, b) => b.weight - a.weight || byCodeUnit(a.to, b.to));
  return { adjacency, barrels, symbols, edgeCount: edges.length, capped: edges.length === MAX_EDGES, truncatedFiles };
}
