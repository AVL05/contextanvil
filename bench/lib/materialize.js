import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

/**
 * Bundle format: a text file where each file starts with a line
 * "=== relative/path ===" and runs until the next marker. Content is verbatim
 * (no escaping), which keeps hand-written fixtures readable.
 */
export function parseBundle(text) {
  const files = {};
  let current = null;
  let buffer = [];
  const flush = () => {
    if (current !== null) files[current] = `${buffer.join('\n')}\n`;
  };
  for (const line of text.split(/\r?\n/)) {
    const m = /^=== (.+) ===$/.exec(line);
    if (m) {
      flush();
      current = m[1];
      buffer = [];
    } else if (current !== null) {
      buffer.push(line);
    }
  }
  flush();
  // Drop the single blank line the final newline of the bundle introduces.
  for (const k of Object.keys(files)) files[k] = files[k].replace(/\n\n$/, '\n');
  return files;
}

export function writeFiles(dir, files) {
  for (const [rel, content] of Object.entries(files)) {
    const abs = path.join(dir, ...rel.split('/'));
    fs.mkdirSync(path.dirname(abs), { recursive: true });
    fs.writeFileSync(abs, content);
  }
}

/** Materialise a dataset source into a fresh temporary directory. */
export function materialize(datasetRoot, source) {
  const base = fs.mkdtempSync(path.join(os.tmpdir(), 'contextanvil-bench-'));
  const dir = path.join(base, 'repo');
  fs.mkdirSync(dir);
  if (source.bundle) {
    writeFiles(dir, parseBundle(fs.readFileSync(path.join(datasetRoot, source.bundle), 'utf8')));
  } else if (source.snapshot) {
    writeFiles(dir, JSON.parse(fs.readFileSync(path.join(datasetRoot, source.snapshot), 'utf8')).files);
  } else {
    throw new Error('unknown dataset source');
  }
  return { dir, cleanup: () => fs.rmSync(base, { recursive: true, force: true }) };
}

/**
 * Deterministic synthetic repository of `n` source files, used only to measure
 * scale (time and memory). Contents are small modules with relative imports.
 */
export function generateScaleRepo(n) {
  const base = fs.mkdtempSync(path.join(os.tmpdir(), 'contextanvil-scale-'));
  const dir = path.join(base, 'repo');
  fs.mkdirSync(dir);
  const files = { 'package.json': '{"name":"scale","type":"module","scripts":{"test":"node --test"}}\n', 'AGENTS.md': '# Scale\n\nGenerated for benchmarking only.\n' };
  const dirs = Math.max(1, Math.round(Math.sqrt(n)));
  for (let i = 0; i < n; i++) {
    const d = `src/pkg${i % dirs}`;
    const prev = i >= dirs ? `./mod${i - dirs}.js` : null;
    files[`${d}/mod${i}.js`] = `${prev ? `import { f${i - dirs} } from '${prev}';\n` : ''}export function f${i}(x) {\n  return ${prev ? `f${i - dirs}(x) + ` : ''}x * ${i % 7};\n}\n// module ${i} word${i % 50} helper${i % 13}\n`;
  }
  writeFiles(dir, files);
  return { dir, cleanup: () => fs.rmSync(base, { recursive: true, force: true }) };
}
