import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
export const BIN = path.join(REPO_ROOT, 'bin', 'contextanvil.js');

export function fixture(name) {
  return path.join(REPO_ROOT, 'test', 'fixtures', name);
}

/**
 * Create a throw-away repository on disk. The directory name contains a space
 * on purpose, so every test also exercises paths that need quoting.
 * @param {Record<string, string|Buffer>} files posix-relative path -> content
 */
export function makeRepo(files = {}) {
  const base = fs.mkdtempSync(path.join(os.tmpdir(), 'contextanvil test-'));
  const root = path.join(base, 'repo');
  fs.mkdirSync(root);
  for (const [rel, content] of Object.entries(files)) {
    const abs = path.join(root, ...rel.split('/'));
    fs.mkdirSync(path.dirname(abs), { recursive: true });
    fs.writeFileSync(abs, content);
  }
  return {
    root,
    base,
    cleanup() {
      fs.rmSync(base, { recursive: true, force: true });
    },
  };
}

/** Try to create a symlink; returns false where the OS forbids it (e.g. Windows without developer mode). */
export function trySymlink(target, linkPath, type) {
  try {
    fs.symlinkSync(target, linkPath, type);
    return true;
  } catch {
    return false;
  }
}

/** Digest of every file under a directory (path + content), used to prove read-only behaviour. */
export function treeDigest(dir) {
  const hash = crypto.createHash('sha256');
  const walk = (d) => {
    for (const ent of fs.readdirSync(d, { withFileTypes: true }).sort((a, b) => (a.name < b.name ? -1 : 1))) {
      const abs = path.join(d, ent.name);
      if (ent.name === 'node_modules' || ent.name === '.git') continue;
      if (ent.isDirectory()) {
        hash.update(`D:${path.relative(dir, abs)}\n`);
        walk(abs);
      } else if (ent.isFile()) {
        const st = fs.statSync(abs);
        hash.update(`F:${path.relative(dir, abs)}:${st.size}:${st.mtimeMs}\n`);
        hash.update(fs.readFileSync(abs));
      }
    }
  };
  walk(dir);
  return hash.digest('hex');
}

/** Secrets are assembled at runtime so this repository never contains scannable secret literals. */
export const FAKE = Object.freeze({
  aws: () => 'AKIA' + 'ABCDEFGHIJKLMNOP',
  github: () => 'ghp_' + 'a1B2'.repeat(9),
  stripe: () => 'sk_live_' + '1234567890abcdefgh',
  generic: () => 'Zq8xLm2Pw9Rt4Vb7Nc',
  privateKey: () => '-----BEGIN ' + 'RSA PRIVATE KEY-----\nMIIBOgIBAAJBAKj34GkxFhD90vcNLYLInFEX6Ppy1tPf9Cnzj4p4WGeKLs1Pt8Qu\n-----END ' + 'RSA PRIVATE KEY-----',
});

export function collector() {
  let text = '';
  return { write: (s) => { text += s; return true; }, get text() { return text; } };
}
