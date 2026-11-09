import crypto from 'node:crypto';
import { KIND_ORDER } from '../core/facts.js';
import { DEFAULT_LIMITS } from '../core/limits.js';
import { byCodeUnit, normalizeRelative } from '../core/paths.js';
import { hasUnsafeCharacters } from '../core/sanitize.js';
import { classifySensitivePath, findSecrets } from '../core/secrets.js';
import { ContextAnvilError } from '../errors.js';
import { readerFor, scanRepository, SCHEMA_VERSION } from '../scanner.js';
import { VERSION } from '../version.js';

const FORMAT = 'contextanvil-manifest';
export const MANIFEST_SCHEMA_VERSION = 1;
export const MAX_MANIFEST_BYTES = 16 * 1024 * 1024;
const MAX_DEPTH = 12;
const digest = (value) => crypto.createHash('sha256').update(value).digest('hex');
export const serializeManifest = (manifest) => JSON.stringify(manifest, null, 2) + '\n';

function fail(message) {
  throw new ContextAnvilError('INVALID_MANIFEST', message);
}

function keys(value, expected) {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
    && Object.keys(value).join(',') === expected && Object.keys(value).length === expected.split(',').length;
}

const number = (value, minimum = 0) => Number.isSafeInteger(value) && value >= minimum;
const sha = (value) => typeof value === 'string' && value.length === 64 && /^[0-9a-f]{64}$/.test(value);
const safeString = (value, max = 4096) => typeof value === 'string' && value.length > 0
  && value.length <= max && !hasUnsafeCharacters(value) && !/[\r\n\t]/.test(value);
const relative = (value) => safeString(value) && normalizeRelative(value) === value
  && !value.includes(':') && !value.split('/').some((segment) => segment.toLowerCase() === '.git')
  && !classifySensitivePath(value);

function sorted(values, predicate, key, unique = true) {
  if (!Array.isArray(values)) return false;
  return values.every((value, i) => predicate(value) && (!i || (unique
    ? byCodeUnit(key(values[i - 1]), key(value)) < 0
    : byCodeUnit(key(values[i - 1]), key(value)) <= 0)));
}

const factKey = (fact) => fact.id + '\0' + fact.digest;
const validFact = (fact) => keys(fact, 'id,kind,status,confidence,evidence,digest')
  && safeString(fact.id) && KIND_ORDER.includes(fact.kind)
  && ['observed', 'inferred'].includes(fact.status) && ['high', 'medium', 'low'].includes(fact.confidence)
  && Array.isArray(fact.evidence) && fact.evidence.length > 0
  && fact.evidence.every((e) => keys(e, 'path,line') && relative(e.path) && (e.line === null || number(e.line, 1)))
  && sha(fact.digest);

function validate(body) {
  if (body?.format !== FORMAT) fail('Expected a ContextAnvil manifest.');
  if (body.schemaVersion !== MANIFEST_SCHEMA_VERSION) fail('Unsupported manifest schema version.');
  if (!keys(body, 'format,schemaVersion,scanner,scan,files,facts,integrity')
    || !keys(body.scanner, 'version,schemaVersion') || !safeString(body.scanner.version, 80)
    || !number(body.scanner.schemaVersion, 1)
    || !keys(body.scan, 'respectIgnore,limits,complete,warnings')
    || typeof body.scan.respectIgnore !== 'boolean' || typeof body.scan.complete !== 'boolean'
    || !keys(body.scan.limits, Object.keys(DEFAULT_LIMITS).join(','))
    || !Object.values(body.scan.limits).every((value) => number(value, 1))
    || !sorted(body.scan.warnings, (value) => safeString(value, 80) && /^[a-z][a-z0-9-]{0,79}$/.test(value), (v) => v)
    || !sorted(body.files, (f) => keys(f, 'path,bytes,sha256') && relative(f.path) && number(f.bytes) && sha(f.sha256), (f) => f.path)
    || !sorted(body.facts, validFact, factKey, false)
    || !keys(body.integrity, 'sha256') || !sha(body.integrity.sha256)) fail('Invalid manifest structure.');
}

function checkText(text) {
  if (Buffer.byteLength(text) > MAX_MANIFEST_BYTES) fail('Manifest exceeds 16 MiB.');
  let depth = 0;
  let quoted = false;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (quoted && ch === '\\') i++;
    else if (ch === '"') quoted = !quoted;
    else if (!quoted && (ch === '[' || ch === '{') && ++depth > MAX_DEPTH) fail('Manifest nesting exceeds the limit.');
    else if (!quoted && (ch === ']' || ch === '}')) depth--;
  }
}

export function parseManifest(text) {
  checkText(text);
  let manifest;
  try {
    manifest = JSON.parse(text);
  } catch {
    fail('Manifest is not valid JSON.');
  }
  validate(manifest);
  if (serializeManifest(manifest) !== text) fail('Manifest is not canonical UTF-8 JSON.');
  const { integrity, ...body } = manifest;
  if (digest(serializeManifest(body)) !== integrity.sha256) fail('Manifest integrity check failed.');
  if (findSecrets(text).length) fail('Manifest contains potentially sensitive metadata.');
  return manifest;
}

/** Reconstruct from a live scan. Never use an old manifest as a detector input. */
export function snapshotRepository(root, options = {}) {
  const scan = scanRepository(root, options);
  const reader = readerFor(scan);
  const warnings = new Set(scan.diagnostics.filter((d) => d.level !== 'info').map((d) => d.code));
  let complete = !scan.stats.truncated && !scan.stats.excluded.unreadable
    && !['depth-limit', 'detector-failed', 'symlink-escape', 'ignore-unreadable'].some((code) => warnings.has(code));
  const files = [];
  for (const { path } of scan.files) {
    const meta = relative(path) ? reader.hashMeta(path) : null;
    if (!meta) {
      complete = false;
      warnings.add('unhashed-file');
      continue;
    }
    files.push({ path, bytes: meta.bytes, sha256: meta.sha256 });
  }
  const facts = [];
  for (const fact of scan.facts) {
    const evidence = fact.evidence.filter((e) => relative(e.path)).map((e) => ({ path: e.path, line: e.line ?? null }));
    if (!safeString(fact.id) || findSecrets(fact.id).length || !evidence.length) {
      complete = false;
      warnings.add('omitted-fact');
      continue;
    }
    facts.push({ id: fact.id, kind: fact.kind, status: fact.status, confidence: fact.confidence,
      evidence, digest: digest(JSON.stringify(fact)) });
  }
  facts.sort((a, b) => byCodeUnit(factKey(a), factKey(b)));
  const body = {
    format: FORMAT,
    schemaVersion: MANIFEST_SCHEMA_VERSION,
    scanner: { version: VERSION, schemaVersion: SCHEMA_VERSION },
    scan: { respectIgnore: options.respectIgnore !== false, limits: scan.limits, complete, warnings: [...warnings].sort(byCodeUnit) },
    files, facts,
  };
  const manifest = { ...body, integrity: { sha256: digest(serializeManifest(body)) } };
  const text = serializeManifest(manifest);
  checkText(text);
  validate(manifest);
  if (findSecrets(text).length) fail('Snapshot contains potentially sensitive metadata.');
  return { manifest, text, root: scan.root,
    reads: reader.filesRead() + scan.ignoreIo.reads, bytesRead: reader.bytesRead() + scan.ignoreIo.bytes };
}

function compare(before, after, key) {
  const index = (items) => {
    const map = new Map();
    for (const item of items) {
      const name = key(item);
      if (!map.has(name)) map.set(name, []);
      map.get(name).push(item);
    }
    return map;
  };
  const old = index(before);
  const live = index(after);
  const added = [];
  const removed = [];
  const changed = [];
  for (const name of [...new Set([...old.keys(), ...live.keys()])].sort(byCodeUnit)) {
    if (!old.has(name)) added.push(name);
    else if (!live.has(name)) removed.push(name);
    else if (JSON.stringify(old.get(name)) !== JSON.stringify(live.get(name))) changed.push(name);
  }
  return { added, removed, changed };
}

export function diffManifest(before, after) {
  return {
    identical: before.integrity.sha256 === after.integrity.sha256,
    complete: before.scan.complete && after.scan.complete,
    metadataChanged: JSON.stringify([before.scanner, before.scan]) !== JSON.stringify([after.scanner, after.scan]),
    files: compare(before.files, after.files, (f) => f.path),
    facts: compare(before.facts, after.facts, (f) => f.id),
  };
}
