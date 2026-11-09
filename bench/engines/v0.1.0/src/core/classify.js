import { basename } from './paths.js';

const LANGUAGE_BY_EXT = new Map([
  ['.js', 'JavaScript'], ['.mjs', 'JavaScript'], ['.cjs', 'JavaScript'], ['.jsx', 'JavaScript'],
  ['.ts', 'TypeScript'], ['.mts', 'TypeScript'], ['.cts', 'TypeScript'], ['.tsx', 'TypeScript'],
  ['.php', 'PHP'], ['.py', 'Python'], ['.go', 'Go'], ['.rs', 'Rust'], ['.rb', 'Ruby'],
  ['.java', 'Java'], ['.vue', 'Vue'], ['.svelte', 'Svelte'],
]);

const LOCK_FILES = new Set([
  'package-lock.json', 'npm-shrinkwrap.json', 'yarn.lock', 'pnpm-lock.yaml', 'bun.lock', 'bun.lockb',
  'composer.lock', 'gemfile.lock', 'cargo.lock', 'poetry.lock', 'go.sum',
]);

const DOC_EXT = new Set(['.md', '.mdx', '.markdown', '.rst', '.txt', '.adoc']);
const CONFIG_EXT = new Set(['.json', '.jsonc', '.yml', '.yaml', '.toml', '.xml', '.ini', '.neon', '.cfg', '.conf']);

const TEST_DIR = /(^|\/)(__tests__|tests?|specs?|__mocks__)\//i;
const TEST_SUFFIX = /\.(test|spec)\.[a-z0-9]+$/i;
const TEST_NAMED = /(?:[A-Za-z0-9]Test\.php|_test\.(?:go|py|rb)|(?:^|\/)test_[^/]*\.py)$/;

export function extensionOf(rel) {
  const name = basename(rel);
  const i = name.lastIndexOf('.');
  return i <= 0 ? '' : name.slice(i).toLowerCase();
}

export function isTestPath(rel) {
  return TEST_DIR.test(rel) || TEST_SUFFIX.test(rel) || TEST_NAMED.test(rel);
}

/**
 * @returns {{ category: 'source'|'test'|'doc'|'config'|'lock'|'other', language: string|null }}
 */
export function classifyFile(rel) {
  const name = basename(rel).toLowerCase();
  if (LOCK_FILES.has(name)) return { category: 'lock', language: null };
  const ext = extensionOf(rel);
  let language = LANGUAGE_BY_EXT.get(ext) ?? null;
  if (name.endsWith('.blade.php')) language = 'Blade';
  if (language) return { category: isTestPath(rel) ? 'test' : 'source', language };
  if (DOC_EXT.has(ext)) return { category: 'doc', language: null };
  if (CONFIG_EXT.has(ext)) return { category: 'config', language: null };
  return { category: 'other', language: null };
}

export function isGeneratedOrLock(rel) {
  return classifyFile(rel).category === 'lock' || /\.min\.(js|css)$/.test(rel) || /\.d\.ts$/.test(rel);
}
