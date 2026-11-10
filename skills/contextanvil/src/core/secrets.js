/**
 * Secret handling. Two independent defences:
 *  1. Sensitive *paths* are never read (classifySensitivePath).
 *  2. Any text that is about to be shown is passed through redact().
 *
 * Detection is heuristic and cannot be exhaustive. See docs/security.md.
 *
 * Every pattern is bounded (no unbounded quantifier sits next to another that
 * can match the same characters) so that hostile input cannot cause
 * catastrophic backtracking. test/security.test.js feeds adversarial inputs.
 */
import { basename } from './paths.js';
import { neutralize } from './sanitize.js';

const SAFE_ENV_SUFFIXES = new Set(['example', 'sample', 'template', 'dist', 'defaults', 'schema']);
const MAX_FINDINGS_PER_RULE = 200;

/** @returns {string | null} A short reason when the path is considered sensitive. */
export function classifySensitivePath(rel) {
  const lower = rel.toLowerCase();
  const name = basename(lower);

  if (name === '.env' || name.startsWith('.env.')) {
    const suffix = name.slice(5);
    const last = suffix.split('.').pop();
    if (suffix && SAFE_ENV_SUFFIXES.has(last)) return null;
    return 'environment file';
  }
  if (name === '.envrc' || name === '.dev.vars') return 'environment file';
  if (/\.(pem|key|p12|pfx|p8|ppk|jks|keystore|kdbx|tfstate|gpg|pgp)$/.test(name)) return 'key or state file';
  if (/^id_(rsa|dsa|ecdsa|ed25519)$/.test(name)) return 'ssh private key';
  if (['.npmrc', '.yarnrc.yml', '.pypirc', '.netrc', '_netrc', '.git-credentials', '.htpasswd', '.dockercfg', '.pgpass', '.vault_pass', '.vault-pass', 'auth.json'].includes(name)) {
    return 'credential store';
  }
  // Data-like names only: a source file such as secrets.js is code, not a credential store.
  if (/^(credentials|secrets?)(\.(json|ya?ml|toml|ini|txt|env|conf|cfg|xml|properties))?$/.test(name)) return 'credentials file';
  if (/\.secrets?$/.test(name)) return 'credentials file';
  if (/^service[-_]?account.*\.json$/.test(name) || /-credentials\.json$/.test(name)) return 'service account credentials';
  if (name === 'terraform.tfvars' || name.endsWith('.auto.tfvars')) return 'terraform variables';
  if (name === 'kubeconfig' || name === 'wp-config.php') return 'credential-bearing config';
  if (/(^|\/)\.aws\/credentials$/.test(lower) || /(^|\/)\.docker\/config\.json$/.test(lower)) return 'credential store';
  if (/(^|\/)\.(ssh|gnupg)\//.test(lower)) return 'key material';
  if (/(^|\/)\.?secrets\//.test(lower)) return 'secrets directory';
  return null;
}

const PLACEHOLDER = /(^\$\{?)|(^<)|(^%)|(^\{\{)|x{3,}|example|your[_-]|changeme|placeholder|dummy|sample|\*{3,}|process\.env|getenv|env\(|\.\.\./i;

function looksLikeRealValue(value) {
  if (PLACEHOLDER.test(value)) return false;
  if (/^(.)\1+$/.test(value)) return false;
  const hasLetter = /[A-Za-z]/.test(value);
  const hasDigit = /\d/.test(value);
  return (hasLetter && hasDigit) || value.length >= 32;
}

/**
 * Each rule: a global regex, a label, optionally a `group` whose match is the
 * secret value (otherwise the whole match is replaced), an `accept` filter and
 * cheap `hints`, of which at least one must be present for the rule to run.
 */
const RULES = [
  { type: 'aws-access-key', hints: ['AKIA', 'ASIA'], re: /\b(?:AKIA|ASIA)[0-9A-Z]{16}\b/g },
  { type: 'github-token', hints: ['gh'], re: /\b(?:gh[pousr]_[A-Za-z0-9]{36,255}|github_pat_[A-Za-z0-9_]{50,255})\b/g },
  { type: 'slack-token', hints: ['xox'], re: /\bxox[abprs]-[A-Za-z0-9-]{10,200}\b/g },
  { type: 'stripe-key', hints: ['k_live_'], re: /\b[sr]k_live_[A-Za-z0-9]{16,200}\b/g },
  { type: 'google-api-key', hints: ['AIza'], re: /\bAIza[0-9A-Za-z_-]{35}\b/g },
  { type: 'npm-token', hints: ['npm_'], re: /\bnpm_[A-Za-z0-9]{36}\b/g },
  { type: 'api-key', hints: ['sk-'], re: /\bsk-(?:ant-)?[A-Za-z0-9_-]{20,200}\b/g },
  { type: 'jwt', hints: ['eyJ'], re: /\beyJ[A-Za-z0-9_-]{10,2000}\.eyJ[A-Za-z0-9_-]{10,2000}\.[A-Za-z0-9_-]{10,2000}\b/g },
  {
    type: 'url-credentials',
    hints: ['://'],
    re: /\b([a-z][a-z0-9+.-]{1,20}:\/\/)([^\s:@/]{1,100}):([^\s@/]{1,200})@/gi,
    group: 3,
    accept: (_scheme, user, pass) => !/^(pass(word)?|secret|changeme|x+|\*+|<.*>|\$\{.*\}|\{\{.*\}\}|example.*)$/i.test(pass) && user !== pass,
  },
  {
    type: 'credential-assignment',
    hints: [':', '='],
    re: /((?:api[_-]?key|secret|token|passw(?:or)?d|credential|auth)[A-Za-z0-9_.-]{0,40})(\s{0,8}[:=]\s{0,8})(["']?)([^\s"'`,;]{12,200})\3/gi,
    group: 4,
    accept: (_key, _sep, _quote, value) => looksLikeRealValue(value),
  },
];

/** 1-based line number lookup for many offsets in one pass over the text. */
function lineLocator(text) {
  const breaks = [];
  for (let i = text.indexOf('\n'); i !== -1; i = text.indexOf('\n', i + 1)) breaks.push(i);
  return (offset) => {
    let lo = 0;
    let hi = breaks.length;
    while (lo < hi) {
      const mid = (lo + hi) >> 1;
      if (breaks[mid] < offset) lo = mid + 1;
      else hi = mid;
    }
    return lo + 1;
  };
}

// Locate delimiters with a linear pass and no limit on the body length. An
// unclosed block is hidden through the next key header or end of input.
function* privateKeyBlocks(text) {
  if (!text.includes('PRIVATE KEY-----')) return;
  let start = null;
  for (const marker of text.matchAll(/-----(BEGIN|END) ([A-Z ]{0,30}PRIVATE KEY)-----/g)) {
    if (marker[1] === 'BEGIN') {
      if (start) yield [start.index, marker.index];
      start = marker;
    } else if (start && start[2] === marker[2]) {
      yield [start.index, marker.index + marker[0].length];
      start = null;
    }
  }
  if (start) yield [start.index, text.length];
}

/**
 * Locate probable secrets. Never returns the secret value itself.
 * @returns {{ type: string, line: number }[]}
 */
export function findSecrets(text) {
  const found = [];
  const seen = new Set();
  const lineOf = lineLocator(text);
  for (const [start] of privateKeyBlocks(text)) {
    const line = lineOf(start);
    if (seen.has(`private-key:${line}`)) continue;
    seen.add(`private-key:${line}`);
    found.push({ type: 'private-key', line });
    if (found.length >= MAX_FINDINGS_PER_RULE) break;
  }
  for (const { type, re, accept, hints } of RULES) {
    if (!hints.some((hint) => text.includes(hint))) continue;
    re.lastIndex = 0;
    let count = 0;
    for (const m of text.matchAll(re)) {
      if (accept && !accept(...m.slice(1))) continue;
      const line = lineOf(m.index);
      const key = `${type}:${line}`;
      if (seen.has(key)) continue;
      seen.add(key);
      found.push({ type, line });
      if (++count >= MAX_FINDINGS_PER_RULE) break;
    }
  }
  return found.sort((a, b) => a.line - b.line || (a.type < b.type ? -1 : 1));
}

/** Replace probable secrets with `[REDACTED:<type>]`. */
export function redact(text) {
  let out = text;
  if (text.includes('PRIVATE KEY-----')) {
    const chunks = [];
    let cursor = 0;
    for (const [start, end] of privateKeyBlocks(text)) {
      const breaks = text.slice(start, end).match(/\r?\n/g) ?? [];
      chunks.push(text.slice(cursor, start), '[REDACTED:private-key]', breaks.join(''));
      cursor = end;
    }
    out = chunks.join('') + text.slice(cursor);
  }
  for (const rule of RULES) {
    const { type, re, group, accept, hints } = rule;
    if (!hints.some((hint) => out.includes(hint))) continue;
    re.lastIndex = 0;
    out = out.replace(re, (...args) => {
      const m = args.slice(0, -2);
      const groups = m.slice(1);
      if (accept && !accept(...groups)) return m[0];
      if (!group) return `[REDACTED:${type}]`;
      const secret = m[group];
      const at = m[0].lastIndexOf(secret);
      return `${m[0].slice(0, at)}[REDACTED:${type}]${m[0].slice(at + secret.length)}`;
    });
  }
  return out;
}

/** Redact before neutralising so display markers cannot disrupt secret matching. */
export function safeText(text) {
  return neutralize(redact(text)).text;
}
