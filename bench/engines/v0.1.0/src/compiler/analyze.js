import path from 'node:path';
import { classifyFile, isGeneratedOrLock } from '../core/classify.js';
import { byCodeUnit, dirname, normalizeRelative } from '../core/paths.js';

const JS_EXT = ['.js', '.mjs', '.cjs', '.jsx', '.ts', '.mts', '.cts', '.tsx'];
const MAX_SYMBOLS = 40;

const JS_PATTERNS = [
  [/^\s*export\s+(?:default\s+)?(?:async\s+)?(function\*?|class|const|let|var|interface|type|enum)\s+([A-Za-z_$][\w$]*)/, 2, 1],
  [/^\s*(?:async\s+)?(function)\*?\s+([A-Za-z_$][\w$]*)\s*\(/, 2, 1],
  [/^\s*(class)\s+([A-Za-z_$][\w$]*)/, 2, 1],
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
    for (const [re, nameGroup, kindGroup] of patterns) {
      const m = re.exec(all[i]);
      if (!m) continue;
      const name = m[nameGroup];
      if (!name || seen.has(name)) break;
      seen.add(name);
      out.push({ name, kind: kindGroup ? m[kindGroup].replace('*', '') : 'export', line: i + 1 });
      break;
    }
    const named = /^\s*export\s*\{([^}]+)\}/.exec(all[i]);
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
  for (const m of text.matchAll(/(?:\bfrom\s+|\bimport\s*\(\s*|\brequire\s*\(\s*|\bimport\s+)['"]([^'"\n]+)['"]/g)) specs.add(m[1]);
  return [...specs];
}

/** Build a resolver for relative and tsconfig/jsconfig-alias imports. All lookups use the file index only. */
function createResolver(scan, reader) {
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
  const tryFile = (base) => {
    const stem = base.replace(/\.(c|m)?jsx?$/, '');
    const candidates = [base, ...JS_EXT.map((e) => base + e), ...JS_EXT.map((e) => `${stem}${e}`), ...JS_EXT.map((e) => `${base}/index${e}`)];
    return candidates.find(has) ?? null;
  };
  return (fromFile, spec) => {
    if (spec.startsWith('.')) {
      const joined = path.posix.normalize(path.posix.join(dirname(fromFile) || '.', spec));
      if (joined.startsWith('..')) return null;
      return tryFile(joined === '.' ? '' : joined);
    }
    for (const { prefix, target } of aliases) {
      if (spec.startsWith(prefix)) return tryFile(path.posix.join(target, spec.slice(prefix.length)));
    }
    return null;
  };
}

/**
 * Read candidate files (bounded) and extract symbols, imports and a lowercase
 * copy of the text for term lookup. Order is deterministic: path-relevance
 * first, then path.
 *
 * @returns {{ analyses: Map<string, object>, scanned: number, skipped: number }}
 */
export function analyzeFiles(scan, reader, orderedPaths, { maxFiles }) {
  const resolve = createResolver(scan, reader);
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
    const symbols = category === 'source' || category === 'test' ? symbolsOf(meta.text, language) : [];
    const imports = (language === 'JavaScript' || language === 'TypeScript')
      ? importSpecifiers(meta.text).map((s) => resolve(rel, s)).filter(Boolean)
      : [];
    analyses.set(rel, {
      symbols,
      imports: [...new Set(imports)].sort(byCodeUnit),
      lower: meta.text.toLowerCase(),
      sha256: meta.sha256.slice(0, 16),
      bytes: meta.bytes,
    });
  }
  return { analyses, scanned: analyses.size, skipped };
}

export function isScorable(rel) {
  if (isGeneratedOrLock(rel)) return false;
  const { category } = classifyFile(rel);
  return category === 'source' || category === 'test' || category === 'doc' || category === 'config';
}
