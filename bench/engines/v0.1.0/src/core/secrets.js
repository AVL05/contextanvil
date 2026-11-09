/**
 * Secret handling. Two independent defences:
 *  1. Sensitive *paths* are never read (classifySensitivePath).
 *  2. Any text that is about to be shown is passed through redact().
 *
 * Detection is heuristic and cannot be exhaustive. See docs/security.md.
 */
import { basename } from './paths.js';

const SAFE_ENV_SUFFIXES = new Set(['example', 'sample', 'template', 'dist', 'defaults', 'schema']);

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
  if (/\.(pem|key|p12|pfx|jks|keystore|kdbx|tfstate)$/.test(name)) return 'key or state file';
  if (/^id_(rsa|dsa|ecdsa|ed25519)$/.test(name)) return 'ssh private key';
  if (['.npmrc', '.pypirc', '.netrc', '_netrc', '.git-credentials', '.htpasswd', '.dockercfg'].includes(name)) {
    return 'credential store';
  }
  // Data-like names only: a source file such as secrets.js is code, not a credential store.
  if (/^(credentials|secrets?)(\.(json|ya?ml|toml|ini|txt|env|conf|cfg|xml|properties))?$/.test(name)) return 'credentials file';
  if (/^service[-_]?account.*\.json$/.test(name) || /-credentials\.json$/.test(name)) return 'service account credentials';
  if (name === 'terraform.tfvars' || name.endsWith('.auto.tfvars')) return 'terraform variables';
  if (name === 'kubeconfig' || name === 'wp-config.php') return 'credential-bearing config';
  if (/(^|\/)\.aws\/credentials$/.test(lower) || /(^|\/)\.docker\/config\.json$/.test(lower)) return 'credential store';
  if (/(^|\/)\.ssh\//.test(lower)) return 'ssh material';
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
 * Each rule: a global regex, a label, and optionally a `group` whose match is
 * the secret value (otherwise the whole match is replaced).
 */
const RULES = [
  { type: 'private-key', re: /-----BEGIN [A-Z ]*PRIVATE KEY-----[\s\S]*?(?:-----END [A-Z ]*PRIVATE KEY-----|$)/g },
  { type: 'aws-access-key', re: /\b(?:AKIA|ASIA)[0-9A-Z]{16}\b/g },
  { type: 'github-token', re: /\b(?:gh[pousr]_[A-Za-z0-9]{36,}|github_pat_[A-Za-z0-9_]{50,})\b/g },
  { type: 'slack-token', re: /\bxox[abprs]-[A-Za-z0-9-]{10,}\b/g },
  { type: 'stripe-key', re: /\b[sr]k_live_[A-Za-z0-9]{16,}\b/g },
  { type: 'google-api-key', re: /\bAIza[0-9A-Za-z_-]{35}\b/g },
  { type: 'npm-token', re: /\bnpm_[A-Za-z0-9]{36}\b/g },
  { type: 'api-key', re: /\bsk-(?:ant-)?[A-Za-z0-9_-]{20,}\b/g },
  { type: 'jwt', re: /\beyJ[A-Za-z0-9_-]{10,}\.eyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\b/g },
  {
    type: 'url-credentials',
    re: /\b([a-z][a-z0-9+.-]*:\/\/)([^\s:@/]+):([^\s@/]+)@/gi,
    group: 3,
    accept: (_scheme, user, pass) => !/^(pass(word)?|secret|changeme|x+|\*+|<.*>|\$\{.*\}|\{\{.*\}\}|example.*)$/i.test(pass) && user !== pass,
  },
  {
    type: 'credential-assignment',
    re: /\b([A-Za-z0-9_.-]*(?:api[_-]?key|secret|token|passw(?:or)?d|credential|auth)[A-Za-z0-9_.-]*)(\s*[:=]\s*)(["']?)([^\s"'`,;]{12,})\3/gi,
    group: 4,
    accept: (_key, _sep, _quote, value) => looksLikeRealValue(value),
  },
];

/**
 * Locate probable secrets. Never returns the secret value itself.
 * @returns {{ type: string, line: number }[]}
 */
export function findSecrets(text) {
  const found = [];
  const seen = new Set();
  for (const { type, re, accept } of RULES) {
    re.lastIndex = 0;
    for (const m of text.matchAll(re)) {
      if (accept && !accept(...m.slice(1))) continue;
      const line = text.slice(0, m.index).split('\n').length;
      const key = `${type}:${line}`;
      if (seen.has(key)) continue;
      seen.add(key);
      found.push({ type, line });
    }
  }
  return found.sort((a, b) => a.line - b.line || (a.type < b.type ? -1 : 1));
}

/** Replace probable secrets with `[REDACTED:<type>]`. */
export function redact(text) {
  let out = text;
  for (const rule of RULES) {
    const { type, re, group, accept } = rule;
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
