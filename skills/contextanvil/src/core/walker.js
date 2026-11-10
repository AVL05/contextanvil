import fs from 'node:fs';
import path from 'node:path';
import { isIgnoredBy, parseIgnore } from './ignore.js';
import { classifySensitivePath, redact } from './secrets.js';
import { byCodeUnit, isInside, realpath, toPosix } from './paths.js';
import { extensionOf } from './classify.js';
import { escapeUnsafe, hasUnsafePathCharacters } from './sanitize.js';
import { createReader } from './reader.js';

/** Directory names that are never traversed (dependencies, build output, caches). */
export const DEFAULT_EXCLUDED_DIRS = new Set([
  '.git', 'node_modules', 'bower_components', 'vendor', 'dist', 'build', 'out', 'coverage',
  '.next', '.nuxt', '.svelte-kit', '.turbo', '.cache', '.parcel-cache', '.nyc_output',
  '__pycache__', '.venv', 'venv', '.tox', '.gradle', '.idea', '.terraform',
]);

/** Repository-relative paths that are never traversed (framework caches and logs). */
export const DEFAULT_EXCLUDED_PATHS = new Set([
  'storage/framework', 'storage/logs', 'bootstrap/cache', 'public/build',
]);

const BINARY_EXT = new Set([
  '.png', '.jpg', '.jpeg', '.gif', '.webp', '.avif', '.ico', '.bmp', '.tiff', '.svgz',
  '.woff', '.woff2', '.ttf', '.otf', '.eot', '.pdf', '.zip', '.gz', '.tgz', '.tar', '.7z', '.rar',
  '.mp3', '.mp4', '.mov', '.avi', '.webm', '.wav', '.ogg', '.exe', '.dll', '.so', '.dylib', '.class',
  '.jar', '.wasm', '.sqlite', '.db', '.psd', '.map',
]);

function byName(a, b) {
  return byCodeUnit(a.name, b.name);
}

/** Ignore files are read only if they are regular files inside the root (a symlink to elsewhere is not followed). */
function readIgnoreFile(root, rel, limits, remaining) {
  const cap = limits.maxIgnoreFileBytes;
  const reader = createReader({
    root, files: [{ path: rel, size: 0 }],
    limits: { maxFileBytes: cap, maxTotalReadBytes: Math.min(cap, remaining) },
  });
  const text = reader.read(rel);
  return { rules: text === null ? null : parseIgnore(text), reads: reader.filesRead(), bytes: reader.bytesRead() };
}

/** List a directory, refusing absurdly large ones so a hostile tree cannot exhaust memory. */
function listDirectory(abs, maxEntries) {
  const dir = fs.opendirSync(abs);
  const entries = [];
  try {
    for (let ent = dir.readSync(); ent !== null; ent = dir.readSync()) {
      if (entries.length >= maxEntries) return { entries: null };
      entries.push(ent);
    }
  } finally {
    dir.closeSync();
  }
  return { entries };
}

/**
 * Breadth-first, deterministic, read-only traversal.
 *
 * Safety properties:
 *  - Directory symlinks are never followed; file symlinks are indexed only if
 *    their real target is inside the root.
 *  - Sensitive files are listed by path only and are never opened.
 *  - Output order depends only on file names (code-unit order), not on the OS.
 *
 * @param {string} root Real absolute path of the repository root.
 * @param {object} limits
 * @param {{ respectIgnore?: boolean }} [options]
 */
export function walkRepository(root, limits, { respectIgnore = true, boundIgnoreIo = false } = {}) {
  const files = [];
  const sensitive = [];
  const diagnostics = [];
  const excluded = { defaultDirs: 0, ignored: 0, binary: 0, sensitive: 0, symlinks: 0, unreadable: 0 };
  let dirsVisited = 0;
  let truncated = false;
  let depthLimited = 0;
  let ignoreReads = 0;
  let ignoreBytes = 0;

  const queue = [{ abs: root, rel: '', depth: 0, sources: [] }];
  outer: for (let qi = 0; qi < queue.length; qi++) {
    const dir = queue[qi];
    queue[qi] = null;
    let entries;
    try {
      ({ entries } = listDirectory(dir.abs, limits.maxDirEntries));
      if (entries === null) {
        excluded.unreadable++;
        diagnostics.push({ level: 'warn', code: 'dir-entry-limit', message: `Directory has more than ${limits.maxDirEntries} entries and was skipped`, path: escapeUnsafe(dir.rel || '.') });
        continue;
      }
    } catch {
      excluded.unreadable++;
      diagnostics.push({ level: 'warn', code: 'unreadable-directory', message: 'Directory could not be read', path: escapeUnsafe(dir.rel || '.') });
      continue;
    }
    dirsVisited++;
    entries.sort(byName);

    let sources = dir.sources;
    if (respectIgnore) {
      for (const name of ['.gitignore', '.contextanvilignore']) {
        if (!entries.some((e) => e.name === name && (e.isFile() || e.isSymbolicLink()))) continue;
        const rel = dir.rel ? `${dir.rel}/${name}` : name;
        const remaining = boundIgnoreIo ? limits.maxTotalReadBytes - ignoreBytes : Infinity;
        const { rules, reads, bytes } = readIgnoreFile(root, rel, limits, remaining);
        ignoreReads += reads;
        ignoreBytes += bytes;
        if (!rules) diagnostics.push({ level: 'warn', code: 'ignore-unreadable', message: 'Ignore rules could not be read safely', path: rel });
        else if (rules.length) sources = [...sources, { base: dir.rel, rules }];
      }
    }

    for (const ent of entries) {
      const rel = dir.rel ? `${dir.rel}/${ent.name}` : ent.name;
      const abs = path.join(dir.abs, ent.name);
      if (ent.name.length >= 15 && redact(ent.name) !== ent.name) {
        excluded.unreadable++;
        diagnostics.push({ level: 'warn', code: 'credential-filename', message: 'Skipped a path containing a probable credential in its name' });
        continue;
      }
      if (hasUnsafePathCharacters(ent.name)) {
        // Names with control or invisible characters could mislead a reader or a terminal; never index them.
        excluded.unreadable++;
        diagnostics.push({ level: 'warn', code: 'unsafe-filename', message: 'Skipped a path containing control or invisible characters', path: escapeUnsafe(rel) });
        continue;
      }
      let isDir = ent.isDirectory();
      let isFile = ent.isFile();
      let symlinkTo;
      let size;

      if (ent.isSymbolicLink()) {
        let real;
        try {
          real = realpath(abs);
        } catch {
          excluded.symlinks++;
          diagnostics.push({ level: 'info', code: 'broken-symlink', message: 'Broken symbolic link skipped', path: rel });
          continue;
        }
        if (!isInside(root, real)) {
          excluded.symlinks++;
          diagnostics.push({ level: 'warn', code: 'symlink-escape', message: 'Symbolic link points outside the repository root and was not followed', path: rel });
          continue;
        }
        const st = fs.statSync(real);
        if (!st.isFile()) {
          excluded.symlinks++; // directory symlinks are never followed
          continue;
        }
        isFile = true;
        isDir = false;
        symlinkTo = toPosix(path.relative(root, real));
        if (redact(symlinkTo) !== symlinkTo || hasUnsafePathCharacters(symlinkTo)) {
          excluded.unreadable++;
          diagnostics.push({ level: 'warn', code: 'unsafe-symlink-target', message: 'Skipped a link to a path whose name cannot be shown safely', path: rel });
          continue;
        }
        size = st.size;
      }

      if (isDir) {
        if (DEFAULT_EXCLUDED_DIRS.has(ent.name) || DEFAULT_EXCLUDED_PATHS.has(rel)) {
          excluded.defaultDirs++;
          continue;
        }
        if (respectIgnore && isIgnoredBy(sources, rel, true)) {
          excluded.ignored++;
          continue;
        }
        let real;
        try {
          real = realpath(abs);
        } catch {
          excluded.unreadable++;
          continue;
        }
        if (!isInside(root, real)) {
          excluded.symlinks++;
          diagnostics.push({ level: 'warn', code: 'symlink-escape', message: 'Directory resolves outside the repository root and was not followed', path: rel });
          continue;
        }
        if (dir.depth + 1 > limits.maxDepth) {
          depthLimited++;
          continue;
        }
        queue.push({ abs, rel, depth: dir.depth + 1, sources });
        continue;
      }

      if (!isFile) continue; // sockets, fifos, devices
      if (ent.name === '.git') {
        excluded.defaultDirs++;
        continue;
      }
      if (respectIgnore && isIgnoredBy(sources, rel, false)) {
        excluded.ignored++;
        continue;
      }
      const reason = classifySensitivePath(rel);
      if (reason) {
        sensitive.push({ path: rel, reason });
        excluded.sensitive++;
        continue;
      }
      const ext = extensionOf(rel);
      if (BINARY_EXT.has(ext)) {
        excluded.binary++;
        continue;
      }
      if (files.length >= limits.maxFiles) {
        truncated = true;
        break outer;
      }
      if (size === undefined) {
        try {
          size = fs.lstatSync(abs).size;
        } catch {
          excluded.unreadable++;
          continue;
        }
      }
      const entry = { path: rel, size, ext };
      if (size > limits.maxFileBytes) entry.oversized = true;
      if (symlinkTo) entry.symlinkTo = symlinkTo;
      files.push(entry);
    }
  }

  if (truncated) {
    diagnostics.push({ level: 'warn', code: 'file-limit', message: `Traversal stopped after ${limits.maxFiles} files; the index is incomplete (raise --max-files)` });
  }
  if (depthLimited) {
    diagnostics.push({ level: 'warn', code: 'depth-limit', message: `${depthLimited} director${depthLimited === 1 ? 'y' : 'ies'} deeper than ${limits.maxDepth} levels were not visited` });
  }
  files.sort((a, b) => byCodeUnit(a.path, b.path));
  sensitive.sort((a, b) => byCodeUnit(a.path, b.path));
  return { files, sensitive, excluded, dirsVisited, truncated, diagnostics, ignoreReads, ignoreBytes };
}
