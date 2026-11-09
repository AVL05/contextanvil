import { classifyFile } from '../core/classify.js';
import { basename, byCodeUnit } from '../core/paths.js';

export const id = 'conventions';

function isPlainObject(v) {
  return v !== null && typeof v === 'object' && !Array.isArray(v);
}

/** Parse the `[*]` section (plus the preamble) of an .editorconfig file. */
function parseEditorConfig(text) {
  const values = {};
  let line = 0;
  let starLine;
  let active = false; // keys before the first section (e.g. root = true) are not formatting rules
  for (const raw of text.split(/\r?\n/)) {
    line++;
    const s = raw.trim();
    if (!s || s.startsWith('#') || s.startsWith(';')) continue;
    const section = /^\[(.*)\]$/.exec(s);
    if (section) {
      active = section[1] === '*';
      if (active && starLine === undefined) starLine = line;
      continue;
    }
    if (!active) continue;
    const kv = /^([A-Za-z_]+)\s*=\s*(.+)$/.exec(s);
    if (kv) values[kv[1].toLowerCase()] = kv[2].trim().toLowerCase();
  }
  return { values, line: starLine };
}

function jsonObjectOrNull(ctx, rel) {
  const text = ctx.read(rel);
  if (text === null || !/^\s*\{/.test(text)) return null; // YAML/other formats are not evaluated
  const value = ctx.readJson(rel);
  return isPlainObject(value) ? value : null;
}

function namingStyle(stem) {
  if (/^[A-Z][a-z0-9]+(?:[A-Z][a-z0-9]*)+$|^[A-Z][a-z0-9]+$/.test(stem) && /[a-z]/.test(stem)) return 'PascalCase';
  if (/^[a-z][a-z0-9]*(?:[A-Z][a-z0-9]*)+$/.test(stem)) return 'camelCase';
  if (/^[a-z0-9]+(?:-[a-z0-9]+)+$/.test(stem)) return 'kebab-case';
  if (/^[a-z0-9]+(?:_[a-z0-9]+)+$/.test(stem)) return 'snake_case';
  return null; // single lowercase words are ambiguous
}

export function detect(ctx) {
  // --- EditorConfig ---------------------------------------------------------
  if (ctx.has('.editorconfig')) {
    const { values, line } = parseEditorConfig(ctx.read('.editorconfig') ?? '');
    const keys = ['indent_style', 'indent_size', 'end_of_line', 'charset', 'insert_final_newline', 'trim_trailing_whitespace'];
    const parts = keys.filter((k) => values[k]).map((k) => `${k}=${values[k]}`);
    if (parts.length) {
      ctx.addFact({
        kind: 'convention', id: 'convention:editorconfig',
        claim: `EditorConfig defaults for all files: ${parts.join(', ')}`,
        evidence: [{ path: '.editorconfig', line }], data: { values },
      });
    }
  }

  // --- Prettier (static JSON only; JavaScript configs are never executed) ----
  const prettierFiles = ['.prettierrc', '.prettierrc.json'].filter((f) => ctx.has(f));
  let prettier = null;
  let prettierPath = null;
  for (const f of prettierFiles) {
    prettier = jsonObjectOrNull(ctx, f);
    if (prettier) { prettierPath = f; break; }
  }
  if (!prettier && ctx.has('package.json')) {
    const pkg = ctx.readJson('package.json');
    if (isPlainObject(pkg?.prettier)) { prettier = pkg.prettier; prettierPath = 'package.json'; }
  }
  if (prettier) {
    const keys = ['semi', 'singleQuote', 'tabWidth', 'useTabs', 'printWidth', 'trailingComma'];
    const parts = keys.filter((k) => prettier[k] !== undefined).map((k) => `${k}=${JSON.stringify(prettier[k])}`);
    if (parts.length) {
      ctx.addFact({
        kind: 'convention', id: 'convention:prettier',
        claim: `Prettier options: ${parts.join(', ')}`,
        evidence: [{ path: prettierPath, line: prettierPath === 'package.json' ? ctx.jsonLine('package.json', 'prettier') : undefined }],
        data: { options: Object.fromEntries(keys.filter((k) => prettier[k] !== undefined).map((k) => [k, prettier[k]])) },
      });
    }
  }

  // --- TypeScript compiler options ------------------------------------------
  const tsconfig = ctx.has('tsconfig.json') ? ctx.readJsonc('tsconfig.json') : undefined;
  if (isPlainObject(tsconfig) && isPlainObject(tsconfig.compilerOptions)) {
    const o = tsconfig.compilerOptions;
    const keys = ['strict', 'target', 'module', 'moduleResolution', 'jsx', 'noUncheckedIndexedAccess'];
    const parts = keys.filter((k) => o[k] !== undefined).map((k) => `${k}=${JSON.stringify(o[k])}`);
    if (isPlainObject(o.paths)) parts.push(`paths=${Object.keys(o.paths).slice(0, 4).join(', ')}`);
    if (parts.length) {
      ctx.addFact({
        kind: 'convention', id: 'convention:typescript',
        claim: `TypeScript compiler options: ${parts.join('; ')}`,
        evidence: [{ path: 'tsconfig.json', line: ctx.jsonLine('tsconfig.json', 'compilerOptions') }],
        data: { strict: o.strict === true },
      });
    }
  }

  // --- Test file naming and layout (counted, then inferred) -----------------
  const testFiles = ctx.files.filter((f) => classifyFile(f.path).category === 'test');
  if (testFiles.length >= 2) {
    const suffix = new Map();
    let inDedicatedDir = 0;
    for (const f of testFiles) {
      const name = basename(f.path);
      const key = /\.test\.[a-z0-9]+$/i.test(name) ? '.test.' : /\.spec\.[a-z0-9]+$/i.test(name) ? '.spec.' : /Test\.php$/.test(name) ? 'Test.php' : /_test\./.test(name) ? '_test.' : 'other';
      suffix.set(key, (suffix.get(key) ?? 0) + 1);
      if (/(^|\/)(__tests__|tests?|specs?)\//i.test(f.path)) inDedicatedDir++;
    }
    const [topKey, topCount] = [...suffix.entries()].sort((a, b) => b[1] - a[1] || byCodeUnit(a[0], b[0]))[0];
    const layout = inDedicatedDir === testFiles.length ? 'all in dedicated test directories' : inDedicatedDir === 0 ? 'all colocated with source files' : `${inDedicatedDir} in dedicated test directories, ${testFiles.length - inDedicatedDir} colocated`;
    const naming = topKey !== 'other' && topCount / testFiles.length >= 0.8 ? `named with "${topKey}" (${topCount} of ${testFiles.length})` : 'with mixed naming';
    ctx.addFact({
      kind: 'convention', id: 'convention:test-layout', status: 'inferred', confidence: testFiles.length >= 4 ? 'high' : 'medium',
      claim: `Test files are ${naming}; ${layout}`,
      evidence: testFiles.slice(0, 3).map((f) => ({ path: f.path })),
      data: { testFiles: testFiles.length, suffix: Object.fromEntries(suffix), dedicatedDirectory: inDedicatedDir },
    });
  }

  // --- JS/TS source file naming style ----------------------------------------
  const styles = new Map();
  const examples = new Map();
  for (const f of ctx.files) {
    const { category, language } = classifyFile(f.path);
    if (category !== 'source' || (language !== 'JavaScript' && language !== 'TypeScript')) continue;
    const stem = basename(f.path).replace(/\.d\.ts$/, '').replace(/\.[^.]+$/, '');
    const style = namingStyle(stem);
    if (!style) continue;
    styles.set(style, (styles.get(style) ?? 0) + 1);
    if (!examples.has(style)) examples.set(style, f.path);
  }
  const styled = [...styles.values()].reduce((a, b) => a + b, 0);
  if (styled >= 5) {
    const [style, count] = [...styles.entries()].sort((a, b) => b[1] - a[1] || byCodeUnit(a[0], b[0]))[0];
    if (count / styled >= 0.75) {
      ctx.addFact({
        kind: 'convention', id: 'convention:file-naming', status: 'inferred', confidence: 'medium',
        claim: `JavaScript/TypeScript source files with multi-word names use ${style} (${count} of ${styled})`,
        evidence: [{ path: examples.get(style) }], data: { style, count, total: styled },
      });
    }
  }
}
