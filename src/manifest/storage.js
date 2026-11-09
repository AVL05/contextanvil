import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { isInside, realpath } from '../core/paths.js';
import { hasUnsafeCharacters } from '../core/sanitize.js';
import { classifySensitivePath } from '../core/secrets.js';
import { ContextAnvilError } from '../errors.js';
import { MAX_MANIFEST_BYTES, parseManifest } from './model.js';

function storageError(message) {
  return new ContextAnvilError('MANIFEST_STORAGE', message);
}

function targetOf(input) {
  const target = path.resolve(input);
  const parent = path.dirname(target);
  const name = path.basename(target);
  if (!name || hasUnsafeCharacters(name) || /[<>:"|?*\r\n\t]/.test(name)
    || /^(?:con|prn|aux|nul|com[1-9¹²³]|lpt[1-9¹²³])(?:\.|$)/i.test(name)
    || name.endsWith('.') || name.endsWith(' ') || classifySensitivePath(name)
    || target.split(path.sep).some((segment) => segment.toLowerCase() === '.git')) {
    throw storageError('Unsafe manifest path.');
  }
  if (path.relative(parent, realpath(parent)) !== '' || !fs.statSync(parent).isDirectory()) {
    throw storageError('Manifest parent must be an existing directory without symlink indirection.');
  }
  return { target, parent, name };
}

const sameFile = (a, b) => a.dev === b.dev && a.ino === b.ino;
const sameRevision = (a, b) => sameFile(a, b) && a.size === b.size
  && a.mtimeNs === b.mtimeNs && a.ctimeNs === b.ctimeNs;
const stat = (target) => fs.lstatSync(target, { bigint: true });

function readFile(target) {
  const original = stat(target);
  if (!original.isFile() || original.size > MAX_MANIFEST_BYTES) {
    throw storageError('Manifest must be a regular file of at most 16 MiB.');
  }
  const fd = fs.openSync(target, fs.constants.O_RDONLY | (fs.constants.O_NOFOLLOW ?? 0) | (fs.constants.O_NONBLOCK ?? 0));
  try {
    const opened = fs.fstatSync(fd, { bigint: true });
    if (!opened.isFile() || !sameRevision(original, opened) || !sameRevision(opened, stat(target))) {
      throw storageError('Manifest changed while opening it.');
    }
    const bytes = Buffer.alloc(Number(opened.size));
    let offset = 0;
    while (offset < bytes.length) {
      const read = fs.readSync(fd, bytes, offset, bytes.length - offset, offset);
      if (!read) break;
      offset += read;
    }
    if (offset !== bytes.length || !sameRevision(opened, fs.fstatSync(fd, { bigint: true }))
      || !sameRevision(opened, stat(target))) throw storageError('Manifest changed while reading it.');
    const text = new TextDecoder('utf-8', { fatal: true, ignoreBOM: true }).decode(bytes);
    return { text, revision: opened };
  } finally {
    fs.closeSync(fd);
  }
}

export function readManifest(input) {
  try {
    const { target } = targetOf(input);
    const result = readFile(target);
    return { ...result, manifest: parseManifest(result.text) };
  } catch (error) {
    if (error instanceof ContextAnvilError) throw error;
    throw storageError('Could not read the manifest as UTF-8 from a regular file.');
  }
}

function assertCurrent(target, expected) {
  const current = readFile(target);
  if (!sameRevision(current.revision, expected.revision) || current.text !== expected.text) {
    throw storageError('Manifest changed since it was read. Retry the update.');
  }
}

function syncDirectory(parent) {
  let fd;
  try {
    fd = fs.openSync(parent, fs.constants.O_RDONLY);
    fs.fsyncSync(fd);
  } catch {
    // Directory fsync is unavailable on some platforms and filesystems.
  } finally {
    if (fd !== undefined) fs.closeSync(fd);
  }
}

/** Publish a complete snapshot at an explicitly chosen external destination. */
export function writeManifest(input, snapshot, expected, { replace = fs.renameSync } = {}) {
  if (!snapshot.manifest.scan.complete) {
    throw storageError(`Incomplete snapshot (${snapshot.manifest.scan.warnings.join(', ')}). No manifest was written.`);
  }
  let lock;
  let lockFd;
  let temporary;
  let ownsTemporary = false;
  let tempFd;
  try {
    const { target, parent, name } = targetOf(input);
    if (isInside(snapshot.root, target)) throw storageError('Write the manifest outside the scanned repository.');
    if (expected && expected.text === snapshot.text) {
      assertCurrent(target, expected);
      return false;
    }
    const directory = stat(parent);
    if (expected) {
      lock = path.join(parent, '.' + name + '.contextanvil-lock');
      lockFd = fs.openSync(lock, 'wx', 0o600);
      assertCurrent(target, expected);
    }
    temporary = path.join(parent, '.contextanvil-' + crypto.randomBytes(16).toString('hex') + '.tmp');
    tempFd = fs.openSync(temporary, 'wx', 0o600);
    ownsTemporary = true;
    fs.writeFileSync(tempFd, snapshot.text, 'utf8');
    fs.fsyncSync(tempFd);
    fs.closeSync(tempFd);
    tempFd = undefined;
    if (path.relative(parent, realpath(parent)) !== '' || !sameFile(directory, stat(parent))) {
      throw storageError('Manifest directory changed during the write.');
    }
    if (expected) {
      assertCurrent(target, expected);
      replace(temporary, target);
    } else {
      // A rename would overwrite an existing target. A same-directory hard link
      // publishes the flushed file atomically and fails if the name is occupied.
      fs.linkSync(temporary, target);
    }
    syncDirectory(parent);
    return true;
  } catch (error) {
    if (error instanceof ContextAnvilError) throw error;
    if (error.code === 'EEXIST') throw storageError('Manifest destination or update lock already exists.');
    if (['EBUSY', 'EACCES', 'EPERM'].includes(error.code)) {
      throw storageError('Could not publish the manifest because a file is busy or access was denied. Retry after releasing it.');
    }
    throw storageError('Could not publish the manifest. Check the destination and filesystem permissions.');
  } finally {
    if (tempFd !== undefined) {
      try { fs.closeSync(tempFd); } catch { /* best effort */ }
    }
    if (ownsTemporary) {
      try { fs.unlinkSync(temporary); } catch { /* best effort */ }
    }
    if (lockFd !== undefined) {
      try { fs.closeSync(lockFd); } catch { /* best effort */ }
      try { fs.unlinkSync(lock); } catch { /* best effort */ }
    }
  }
}
