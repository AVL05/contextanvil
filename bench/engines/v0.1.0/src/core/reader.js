import crypto from 'node:crypto';
import fs from 'node:fs';
import { isInside, normalizeRelative, resolveUnder } from './paths.js';

/**
 * The only way detectors and the compiler touch file contents.
 *
 * Guarantees:
 *  - Only paths present in the walker's index can be read (no arbitrary paths,
 *    so traversal strings from repository text can never reach the filesystem).
 *  - The real path is re-checked against the root immediately before opening.
 *  - Size, binary-content and total-bytes limits are enforced.
 *  - Failures yield null plus a content-free diagnostic.
 *
 * Known limitation: a time-of-check/time-of-use race is possible if another
 * process swaps a file for a symlink during a run.
 */
export function createReader({ root, files, limits, diagnostics = [] }) {
  const index = new Map(files.map((f) => [f.path, f]));
  const cache = new Map();
  const warned = new Set();
  let totalRead = 0;

  function warn(code, message, p) {
    const key = `${code}\0${p}`;
    if (warned.has(key)) return;
    warned.add(key);
    diagnostics.push({ level: 'warn', code, message, path: p });
  }

  function loadUncached(rel) {
    const entry = index.get(rel);
    if (!entry) return null;
    if (entry.oversized) {
      warn('file-too-large', `File exceeds the ${limits.maxFileBytes}-byte read limit and was not read`, rel);
      return null;
    }
    if (totalRead + entry.size > limits.maxTotalReadBytes) {
      warn('read-budget-exhausted', 'Total read budget reached; file was not read', rel);
      return null;
    }
    let fd;
    try {
      const real = fs.realpathSync(resolveUnder(root, rel));
      if (!isInside(root, real)) {
        warn('symlink-escape', 'Path resolves outside the repository root and was not read', rel);
        return null;
      }
      fd = fs.openSync(real, 'r');
      const st = fs.fstatSync(fd);
      if (!st.isFile()) return null;
      if (st.size > limits.maxFileBytes) {
        warn('file-too-large', `File exceeds the ${limits.maxFileBytes}-byte read limit and was not read`, rel);
        return null;
      }
      const buf = Buffer.alloc(st.size);
      let off = 0;
      while (off < st.size) {
        const n = fs.readSync(fd, buf, off, st.size - off, off);
        if (n === 0) break;
        off += n;
      }
      totalRead += off;
      const data = buf.subarray(0, off);
      if (data.subarray(0, 8000).includes(0)) return null; // binary content
      let text = data.toString('utf8');
      if (text.charCodeAt(0) === 0xfeff) text = text.slice(1);
      return { text, bytes: off, sha256: crypto.createHash('sha256').update(data).digest('hex') };
    } catch {
      warn('read-failed', 'File could not be read', rel);
      return null;
    } finally {
      if (fd !== undefined) fs.closeSync(fd);
    }
  }

  function readMeta(rel) {
    const norm = normalizeRelative(rel);
    if (!norm) return null;
    if (!cache.has(norm)) cache.set(norm, loadUncached(norm));
    return cache.get(norm);
  }

  return {
    root,
    has: (rel) => index.has(rel),
    entry: (rel) => index.get(rel),
    readMeta,
    read: (rel) => readMeta(rel)?.text ?? null,
    /**
     * Existence check for an untrusted reference. Safe against traversal and
     * symlink escape; reveals nothing about contents.
     */
    exists(rel) {
      const norm = normalizeRelative(rel);
      if (!norm) return false;
      if (index.has(norm)) return true;
      try {
        return isInside(root, fs.realpathSync(resolveUnder(root, norm)));
      } catch {
        return false;
      }
    },
    bytesRead: () => totalRead,
  };
}
