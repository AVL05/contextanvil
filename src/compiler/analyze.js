import path from 'node:path';
import { classifyFile, isGeneratedOrLock } from '../core/classify.js';
import { byCodeUnit, dirname, normalizeRelative } from '../core/paths.js';
import { contentNeedle } from './terms.js';
import { extractRelationships } from './relationships.js';

const JS_EXT = ['.js', '.mjs', '.cjs', '.jsx', '.ts', '.mts', '.cts', '.tsx'];
const MAX_SYMBOLS = 40;
const MAX_COUNT = 20;

const JS_PATTERNS = [
  [/^\s*export\s+(?:default\s+)?(?:async\s+)?(function\*?|class|const|let|var|interface|type|enum)\s+([A-Za-z_$][\w$]*)/, 2, 1],
  [/^\s*(?:async\s+)?(function)\*?\s+([A-Za-z_$][\w$]*)\s*\(/, 2, 1],
  [/^\s*(class)\s+([A-Za-z_$][\w$]*)/, 2, 1],
  [/^(const|let)\s+([A-Za-z_$][\w$]*)\s*=/, 2, 1], // top-level declarations: registries, tables, constants
  [/^\s*(?:const|let)\s+([A-Z][\w$]*)\s*=\s*(?:\(|async\b|React\.|memo\(|forwardRef\()/, 1, null],
  [/^\s*(?:module\.)?exports\.([A-Za-z_$][\w$]*)\s*=/, 1, null],
];
const PHP_PATTERNS = [
  [/^\s*(?:abstract\s+|final\s+)*(class|interface|trait|enum)\s+([A-Za-z_]\w*)/, 2, 1],
  [/^\s*(?:(?:public|protected|private|static)\s+)*(function)\s+([A-Za-z_]\w*)/, 2, 1],
];

function symbolsOf(text, language) {
  const patterns = language === 'PHP' ? PHP_PATTERNS : language === 'JavaScript' || language === 'TypeScript' ? JS_PATTERNS : [];
  const out = [];
  const seen = new Set();
  const all = text.split(/\r?\n/);
  for (let i = 0; i < all.length && out.length < MAX_SYMBOLS; i++) {
    if (all[i].length > 2000) continue; // minified or generated line: not worth a regex pass
    for (const [re, nameGroup, kindGroup] of patterns) {
      const m = re.exec(all[i]);
      if (!m) continue;
      const name = m[nameGroup];
      if (!name || seen.has(name)) break;
      seen.add(name);
      out.push({ name, kind: kindGroup ? m[kindGroup].replace('*', '') : 'export', line: i + 1 });
      break;
    }
    const named = /^\s*export\s*\{([^}]{0,500})\}/.exec(all[i]);
    if (named) {
      for (const part of named[1].split(',')) {
        const name = part.trim().split(/\s+as\s+/).pop()?.trim();
        if (name && /^[A-Za-z_$][\w$]*$/.test(name) && !seen.has(name) && out.length < MAX_SYMBOLS) {
          seen.add(name);
          out.push({ name, kind: 'export', line: i + 1 });
        }
      }
    }
  }
  return out;
}

function importSpecifiers(text) {
  const specs = new Set();
  for (const m of text.matchAll(/(?:\bfrom\s+|\bimport\s*\(\s*|\brequire\s*\(\s*|\bimport\s+)['"]([^'"\n]{1,300})['"]/g)) specs.add(m[1]);
  return [...specs];
}

/** Build resolvers for JS/TS (relative + tsconfig aliases) and PHP (PSR-4 `use`, same-namespace references, Blade `view()`). */
function createResolvers(scan, reader) {
  const aliases = [];
  for (const cfg of ['tsconfig.json', 'jsconfig.json']) {
    if (!reader.has(cfg)) continue;
    const text = reader.read(cfg);
    if (!text) continue;
    try {
      const stripped = text.replace(/\/\*[\s\S]*?\*\/|(^|[^:"'\\])\/\/.*$/gm, '$1').replace(/,(\s*[}\]])/g, '$1');
      const opts = JSON.parse(stripped).compilerOptions ?? {};
      const base = opts.baseUrl ? normalizeRelative(opts.baseUrl) ?? '' : '';
      for (const [pattern, targets] of Object.entries(opts.paths ?? {})) {
        if (!pattern.endsWith('/*') || !Array.isArray(targets) || typeof targets[0] !== 'string' || !targets[0].endsWith('/*')) continue;
        const target = normalizeRelative(path.posix.join(base, targets[0].slice(0, -2))) ?? '';
        aliases.push({ prefix: pattern.slice(0, -1), target });
      }
    } catch {
      // Unparseable config: aliases are simply unavailable.
    }
  }
  const has = (p) => reader.has(p);
  const tryFile = (base, strict) => {
    const stem = base.replace(/\.(c|m)?jsx?$/, '');
    const candidates = [base, ...JS_EXT.map((e) => base + e), ...JS_EXT.map((e) => `${stem}${e}`), ...JS_EXT.map((e) => `${base}/index${e}`)];
    if (!strict || has(base)) return candidates.find(has) ?? null;
    const matches = [...new Set(candidates.filter(has))];
    return matches.length === 1 ? matches[0] : null;
  };
  const js = (fromFile, spec, strict = false) => {
    if (spec.startsWith('.')) {
      const joined = path.posix.normalize(path.posix.join(dirname(fromFile) || '.', spec));
      if (joined.startsWith('..')) return null;
      return tryFile(joined === '.' ? '' : joined, strict);
    }
    for (const { prefix, target } of aliases) {
      if (spec.startsWith(prefix)) return tryFile(path.posix.join(target, spec.slice(prefix.length)), strict);
    }
    return null;
  };

  const psr4 = scan.facts
    .filter((f) => f.id.startsWith('convention:psr4:'))
    .flatMap((f) => f.data.directories.map((dir) => ({ ns: f.data.namespace, dir: dir.replace(/\/$/, '') })))
    .sort((a, b) => b.ns.length - a.ns.length || byCodeUnit(a.ns, b.ns));
  const fqToPath = (fq, strict = false) => {
    const matches = new Set();
    for (const { ns, dir } of psr4) {
      if (!fq.startsWith(ns)) continue;
      const rel = `${dir ? `${dir}/` : ''}${fq.slice(ns.length).replace(/\\/g, '/')}.php`;
      if (has(rel)) {
        if (!strict) return rel;
        matches.add(rel);
      }
    }
    return matches.size === 1 ? matches.values().next().value : null;
  };
  const php = (text) => {
    const out = new Set();
    const ns = /^\s*namespace\s+([\w\\]+)\s*;/m.exec(text)?.[1];
    const imported = new Set();
    for (const m of text.matchAll(/^\s*use\s+([\w\\]+)(?:\s+as\s+(\w+))?\s*;/gm)) {
      imported.add(m[2] ?? m[1].split('\\').pop());
      const p = fqToPath(m[1].replace(/^\\/, ''));
      if (p) out.add(p);
    }
    if (ns) {
      for (const m of text.matchAll(/\b(?:new|extends|implements|instanceof)\s+([A-Z]\w*)|\b([A-Z]\w*)::/g)) {
        const name = m[1] ?? m[2];
        if (imported.has(name)) continue;
        const p = fqToPath(`${ns}\\${name}`);
        if (p) out.add(p);
      }
    }
    for (const m of text.matchAll(/\bview\(\s*['"]([\w.-]{1,200})['"]/g)) {
      const p = `resources/views/${m[1].replace(/\./g, '/')}.blade.php`;
      if (has(p)) out.add(p);
    }
    return [...out];
  };
  const nextEntries = new Set(scan.facts.filter((f) => f.kind === 'entrypoint' && f.data?.via === 'next').map((f) => f.data.path));
  return { js, php, fqToPath, has, nextEntries };
}

/**
 * Read candidate files (bounded) and extract symbols, imports and per-term
 * occurrence counts. File text is not retained. Order is deterministic.
 *
 * @returns {{ analyses: Map<string, object>, skipped: number }}
 */
export function analyzeFiles(scan, reader, orderedPaths, { maxFiles, terms = [], relationshipIndex = false }) {
  const resolvers = createResolvers(scan, reader);
  const needles = terms.filter((t) => t.length >= 3).map((t) => [t, contentNeedle(t)]);
  const analyses = new Map();
  let skipped = 0;
  for (const rel of orderedPaths) {
    if (analyses.size >= maxFiles) {
      skipped++;
      continue;
    }
    const { category, language } = classifyFile(rel);
    const meta = reader.readMeta(rel);
    if (!meta) {
      skipped++;
      continue;
    }
    const relationships = relationshipIndex ? extractRelationships(meta.text, language, rel, resolvers) : null;
    const symbols = relationshipIndex
      ? [...(relationships?.symbols ?? [])].map(([name, line]) => ({ name, kind: 'identifier', line }))
      : category === 'source' || category === 'test' ? symbolsOf(meta.text, language) : [];
    let imports = [];
    if (relationshipIndex) {
      imports = relationships?.links.map((link) => link.target) ?? [];
    } else if (language === 'JavaScript' || language === 'TypeScript') {
      imports = importSpecifiers(meta.text).map((s) => resolvers.js(rel, s)).filter(Boolean);
    } else if (language === 'PHP' || language === 'Blade') {
      imports = resolvers.php(meta.text);
    }
    const lower = meta.text.toLowerCase();
    const hits = {};
    for (const [term, needle] of needles) {
      let count = 0;
      for (let at = lower.indexOf(needle); at !== -1 && count < MAX_COUNT; at = lower.indexOf(needle, at + needle.length)) count++;
      if (count) hits[term] = count;
    }
    analyses.set(rel, {
      symbols,
      imports: [...new Set(imports)].filter((p) => p !== rel).sort(byCodeUnit),
      hits,
      sha256: meta.sha256.slice(0, 16),
      bytes: meta.bytes,
      ...(relationshipIndex && { relationships }),
    });
  }
  return { analyses, skipped };
}

export function isScorable(rel) {
  if (isGeneratedOrLock(rel)) return false;
  const { category } = classifyFile(rel);
  return category === 'source' || category === 'test' || category === 'doc' || category === 'config';
}
