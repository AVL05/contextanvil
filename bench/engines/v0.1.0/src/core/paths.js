import path from 'node:path';

/** Convert a platform path to a forward-slash path. */
export function toPosix(p) {
  return path.sep === '/' ? p : p.split(path.sep).join('/');
}

/** True when `target` is `root` or lies beneath it (both must be absolute and real). */
export function isInside(root, target) {
  const rel = path.relative(root, target);
  if (rel === '') return true;
  if (path.isAbsolute(rel)) return false; // different drive on Windows
  return rel !== '..' && !rel.startsWith(`..${path.sep}`);
}

/**
 * Normalise an untrusted, repository-relative reference into a clean
 * forward-slash path. Returns null for anything that is absolute, contains a
 * NUL byte, or escapes the root via `..`.
 */
export function normalizeRelative(input) {
  if (typeof input !== 'string' || input.length === 0 || input.includes('\0')) return null;
  const s = input.replace(/\\/g, '/');
  if (s.startsWith('/') || /^[A-Za-z]:/.test(s)) return null;
  const n = path.posix.normalize(s);
  if (n === '.' || n === '..' || n.startsWith('../')) return null;
  return n.replace(/\/$/, '');
}

/** Join posix segments into a platform path under `root` (input must be normalised). */
export function resolveUnder(root, posixRel) {
  return path.join(root, ...posixRel.split('/'));
}

export function dirname(posixRel) {
  const i = posixRel.lastIndexOf('/');
  return i === -1 ? '' : posixRel.slice(0, i);
}

export function basename(posixRel) {
  const i = posixRel.lastIndexOf('/');
  return i === -1 ? posixRel : posixRel.slice(i + 1);
}

/** Locale-independent comparator so output never depends on the machine. */
export function byCodeUnit(a, b) {
  return a < b ? -1 : a > b ? 1 : 0;
}
