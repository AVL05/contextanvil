import fs from 'node:fs';
import path from 'node:path';
import { ContextAnvilError } from './errors.js';
import { KIND_ORDER } from './core/facts.js';
import { resolveLimits } from './core/limits.js';
import { byCodeUnit, realpath } from './core/paths.js';
import { createReader } from './core/reader.js';
import { walkRepository } from './core/walker.js';
import { createDetectorContext } from './detectors/context.js';
import { DETECTORS } from './detectors/index.js';
import { TOOL_NAME, VERSION } from './version.js';

export const SCHEMA_VERSION = 1;

/**
 * Analyse a repository without modifying it or executing anything in it.
 *
 * @param {string} [rootInput] Repository directory.
 * @param {object} [options] Limits (maxFiles, maxDepth, maxFileBytes, ...) and `respectIgnore`.
 * @returns {object} ScanResult (plain data; `reader` is attached as a non-enumerable property).
 */
export function scanRepository(rootInput = '.', options = {}) {
  const limits = resolveLimits(options);
  let root;
  try {
    root = realpath(path.resolve(rootInput));
  } catch {
    throw new ContextAnvilError('ROOT_NOT_FOUND', `Path does not exist or is not accessible: ${rootInput}`);
  }
  if (!fs.statSync(root).isDirectory()) {
    throw new ContextAnvilError('ROOT_NOT_DIRECTORY', `Not a directory: ${rootInput}`);
  }

  const walk = walkRepository(root, limits, { respectIgnore: options.respectIgnore !== false });
  const diagnostics = [...walk.diagnostics];
  const reader = createReader({ root, files: walk.files, limits, diagnostics });
  const ctx = createDetectorContext({ root, files: walk.files, reader, diagnostics });

  for (const detector of DETECTORS) {
    try {
      detector.detect(ctx);
    } catch (err) {
      // Never echo err.message: it could quote repository content.
      const detail = process.env.CONTEXTANVIL_DEBUG ? `: ${err.message}` : '';
      diagnostics.push({ level: 'error', code: 'detector-failed', message: `Detector "${detector.id}" failed (${err.name})${detail}` });
    }
  }

  const facts = ctx.facts
    .map((fact, order) => ({ fact, order }))
    .sort((a, b) => KIND_ORDER.indexOf(a.fact.kind) - KIND_ORDER.indexOf(b.fact.kind) || a.order - b.order)
    .map(({ fact }) => fact);

  const documents = [...ctx.documents].sort((a, b) => byCodeUnit(a.path, b.path));
  const seenDiag = new Set();
  const uniqueDiagnostics = diagnostics.filter((d) => {
    const key = `${d.level}|${d.code}|${d.path ?? ''}|${d.line ?? ''}|${d.message}`;
    if (seenDiag.has(key)) return false;
    seenDiag.add(key);
    return true;
  });

  const result = {
    schemaVersion: SCHEMA_VERSION,
    tool: { name: TOOL_NAME, version: VERSION },
    root,
    limits,
    stats: {
      filesIndexed: walk.files.length,
      directoriesVisited: walk.dirsVisited,
      bytesIndexed: walk.files.reduce((n, f) => n + f.size, 0),
      truncated: walk.truncated,
      excluded: walk.excluded,
    },
    facts,
    documents,
    sensitiveFiles: walk.sensitive,
    diagnostics: uniqueDiagnostics,
    files: walk.files,
  };
  Object.defineProperty(result, 'reader', { value: reader, enumerable: false });
  Object.defineProperty(result, 'ignoreIo', { value: { reads: walk.ignoreReads, bytes: walk.ignoreBytes }, enumerable: false });
  return result;
}

/** Create a reader for a scan result that no longer carries one (e.g. parsed from JSON). */
export function readerFor(scan) {
  return scan.reader ?? createReader({ root: scan.root, files: scan.files, limits: scan.limits, diagnostics: [] });
}
