#!/usr/bin/env node
// Custodian tool: materialize each pinned Git tree from raw Git objects into a read-only snapshot.
//
//   node materialize.mjs --out DIR [--only OWNER/NAME] [--remote-base URL] [--inputs FILE]
//                        [--identities FILE] [--allow-symlink-fallback]
//
// Files are written from raw blob bytes, so no hook, filter, attribute, end-of-line conversion or
// export-ignore rule can change the sample. Nothing in a snapshot is executed. Run it on Linux or
// macOS: Windows may refuse to create symbolic links, which this tool reports and does not hide.
// It is the only holdout tool that uses the network, and it never runs Doctor.
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import {
  chmodSync, existsSync, lstatSync, mkdirSync, mkdtempSync, readdirSync, rmSync, symlinkSync, writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve, sep } from 'node:path';
import {
  ToolError, byCodeUnit, fail, isMain, loadIdentities, loadInputs, sha256, toTsv,
} from './lib.mjs';

const slugOf = (repository) => repository.replace('/', '--');

// An empty config file and an empty hooks directory stand in for the user's and system's Git settings.
let quarantine;
function isolation() {
  if (!quarantine) {
    quarantine = mkdtempSync(join(tmpdir(), 'contextanvil-git-'));
    writeFileSync(join(quarantine, 'config'), '');
    mkdirSync(join(quarantine, 'hooks'));
    process.on('exit', () => rmSync(quarantine, { recursive: true, force: true }));
  }
  return quarantine;
}

function git(args, { cwd, input, local = false } = {}) {
  const empty = isolation();
  const protocol = local ? ['-c', 'protocol.file.allow=always'] : ['-c', 'protocol.allow=never', '-c', 'protocol.https.allow=always'];
  const result = spawnSync('git', ['-c', `core.hooksPath=${join(empty, 'hooks')}`, '-c', 'core.fsmonitor=false', ...protocol, ...args], {
    cwd, input, maxBuffer: 1 << 30,
    env: {
      PATH: process.env.PATH, SystemRoot: process.env.SystemRoot, HOME: process.env.HOME, USERPROFILE: process.env.USERPROFILE,
      GIT_CONFIG_GLOBAL: join(empty, 'config'), GIT_CONFIG_SYSTEM: join(empty, 'config'), GIT_TERMINAL_PROMPT: '0', GIT_ATTR_NOSYSTEM: '1',
    },
  });
  if (result.status !== 0) fail(`git ${args[0]} failed: ${result.stderr?.toString().split('\n')[0] ?? result.error?.message}`);
  return result.stdout;
}

const blobId = (data) => createHash('sha1').update(`blob ${data.length}\0`).update(data).digest('hex');

/** Reject names that could escape the snapshot or collide with Git metadata. Returns a reason or ''. */
export function unsafePathReason(path) {
  if (!path || path.startsWith('/') || /^[A-Za-z]:/.test(path) || path.includes('\\') || /[\0\r\n]/.test(path)) return 'unsafe character or root';
  const parts = path.split('/');
  if (parts.some((p) => p === '' || p === '.' || p === '..' || p.toLowerCase() === '.git')) return 'dot or Git metadata component';
  return '';
}

function assertNoSymlinkParent(root, absolute) {
  let current = root;
  for (const part of absolute.slice(root.length + 1).split(sep).slice(0, -1)) {
    current = join(current, part);
    if (existsSync(current) && lstatSync(current).isSymbolicLink()) fail(`Refusing to write through a symbolic link: ${current}`);
  }
}

function lockReadOnly(dir) {
  for (const name of readdirSync(dir)) {
    const full = join(dir, name);
    const stat = lstatSync(full);
    if (stat.isSymbolicLink()) continue;
    if (stat.isDirectory()) lockReadOnly(full);
    else chmodSync(full, 0o444);
  }
  if (process.platform !== 'win32') chmodSync(dir, 0o555);
}

export function materializeRepository(entry, identity, { out, remoteBase, allowSymlinkFallback }) {
  const slug = slugOf(entry.repository);
  const local = !/^https:\/\//.test(remoteBase);
  const cache = join(out, '.cache', `${slug}.git`);
  const snapshot = join(out, 'snapshots', slug);
  if (existsSync(snapshot)) fail(`${snapshot} already exists. Use a fresh output directory.`);
  mkdirSync(cache, { recursive: true });
  git(['init', '--bare', '--quiet'], { cwd: cache });
  const remote = local ? join(remoteBase, ...entry.repository.split('/')) : `${remoteBase}${entry.repository}.git`;
  git(['fetch', '--quiet', '--depth', '1', '--no-tags', '--no-recurse-submodules', remote, entry.commit], { cwd: cache, local });

  if (git(['cat-file', '-t', entry.commit], { cwd: cache }).toString().trim() !== 'commit') fail(`${entry.repository}: ${entry.commit} is not a commit`);
  const tree = git(['rev-parse', `${entry.commit}^{tree}`], { cwd: cache }).toString().trim();
  if (identity && identity.tree !== tree) fail(`${entry.repository}: tree ${tree} differs from the recorded ${identity.tree}`);

  const listing = git(['ls-tree', '-r', '-z', '-l', '--full-tree', entry.commit], { cwd: cache }).toString('utf8').split('\0').filter(Boolean)
    .map((line) => {
      const [meta, path] = [line.slice(0, line.indexOf('\t')), line.slice(line.indexOf('\t') + 1)];
      const [mode, type, sha, size] = meta.trim().split(/\s+/);
      return { mode, type, sha, size: size === '-' ? 0 : Number(size), path };
    }).sort((a, b) => byCodeUnit(a.path, b.path));

  const byPath = new Map(listing.map((e) => [e.path, e]));
  for (const reserved of entry.paths) {
    const found = byPath.get(reserved.path);
    if (!found || found.mode !== reserved.mode || found.sha !== reserved.sha) {
      fail(`${entry.repository}: reserved path ${reserved.path} does not match the pinned tree`);
    }
  }

  mkdirSync(snapshot, { recursive: true });
  const unavailable = [];
  const blobs = listing.filter((e) => e.type === 'blob');
  for (let start = 0; start < blobs.length; start += 1000) {
    const chunk = blobs.slice(start, start + 1000);
    const output = git(['cat-file', '--batch'], { cwd: cache, input: `${chunk.map((e) => e.sha).join('\n')}\n` });
    let offset = 0;
    for (const item of chunk) {
      const newline = output.indexOf(0x0a, offset);
      const [sha, type, size] = output.subarray(offset, newline).toString().split(' ');
      if (sha !== item.sha || type !== 'blob') fail(`${entry.repository}: unexpected object stream for ${item.path}`);
      const data = output.subarray(newline + 1, newline + 1 + Number(size));
      offset = newline + 1 + Number(size) + 1;
      if (blobId(data) !== item.sha) fail(`${entry.repository}: ${item.path} content does not match its blob id`);
      const reason = unsafePathReason(item.path);
      if (reason) { unavailable.push({ path: item.path, reason }); continue; }
      const target = resolve(snapshot, ...item.path.split('/'));
      if (!target.startsWith(snapshot + sep)) { unavailable.push({ path: item.path, reason: 'outside snapshot' }); continue; }
      mkdirSync(dirname(target), { recursive: true });
      assertNoSymlinkParent(snapshot, target);
      if (item.mode === '120000') {
        try { symlinkSync(data.toString('utf8'), target); } catch (error) {
          if (!allowSymlinkFallback) fail(`${entry.repository}: cannot create symbolic link ${item.path} (${error.code}). Run on Linux or macOS, or pass --allow-symlink-fallback to record it as unavailable.`);
          unavailable.push({ path: item.path, reason: `symbolic link not created (${error.code})` });
        }
      } else {
        writeFileSync(target, data, { flag: 'wx' });
      }
    }
  }
  for (const item of listing.filter((e) => e.type === 'commit')) {
    mkdirSync(join(snapshot, ...item.path.split('/')), { recursive: true });
    unavailable.push({ path: item.path, reason: 'submodule not downloaded' });
  }
  lockReadOnly(snapshot);

  mkdirSync(join(out, 'listings'), { recursive: true });
  const rows = listing.map((e) => ({ path: e.path, mode: e.mode, type: e.type, blob_sha: e.sha, size: e.size }));
  const listingText = toTsv(['path', 'mode', 'type', 'blob_sha', 'size'], rows);
  writeFileSync(join(out, 'listings', `${slug}.tsv`), listingText);
  const record = {
    repository: entry.repository, commit: entry.commit, tree, entries: listing.length,
    symlinks: listing.filter((e) => e.mode === '120000').length, submodules: listing.filter((e) => e.type === 'commit').length,
    listingSha256: sha256(listingText), unavailable,
  };
  mkdirSync(join(out, 'records'), { recursive: true });
  writeFileSync(join(out, 'records', `${slug}.json`), JSON.stringify(record, null, 2) + '\n');
  rmSync(cache, { recursive: true, force: true });
  return record;
}

export function materialize({ out, inputsPath, identitiesPath, only, remoteBase = 'https://github.com/', allowSymlinkFallback = false }) {
  if (!out) fail('--out DIR is required');
  const inputs = loadInputs(inputsPath);
  const identities = identitiesPath === null ? [] : loadIdentities(identitiesPath);
  const records = [];
  for (const entry of inputs.filter((e) => !only || e.repository === only)) {
    const identity = identities.find((i) => i.repository === entry.repository);
    records.push(materializeRepository(entry, identity, { out: resolve(out), remoteBase, allowSymlinkFallback }));
  }
  if (!records.length) fail('No repository selected.');
  rmSync(join(resolve(out), '.cache'), { recursive: true, force: true });
  return records;
}

if (isMain(import.meta.url)) {
  const args = process.argv.slice(2);
  const value = (flag) => (args.includes(flag) ? args[args.indexOf(flag) + 1] : undefined);
  try {
    const records = materialize({
      out: value('--out'), inputsPath: value('--inputs'), identitiesPath: value('--identities') ?? (value('--inputs') ? null : undefined),
      only: value('--only'), remoteBase: value('--remote-base'), allowSymlinkFallback: args.includes('--allow-symlink-fallback'),
    });
    for (const r of records) console.log(`${r.repository} ${r.commit} tree ${r.tree} entries ${r.entries} unavailable ${r.unavailable.length}`);
    console.log(`Snapshots are read-only under ${resolve(value('--out'), 'snapshots')}. Nothing was executed.`);
  } catch (error) {
    if (!(error instanceof ToolError)) throw error;
    console.error(error.message);
    process.exitCode = 2;
  }
}
