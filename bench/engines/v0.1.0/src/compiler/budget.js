import { usageError } from '../errors.js';

/**
 * Honest budget model. ContextAnvil has no tokenizer, so token counts are an
 * estimate (UTF-8 bytes / 4, rounded up) and are always labelled as such.
 * Byte counts are exact.
 */
export const BYTES_PER_TOKEN = 4;
export const DEFAULT_BUDGET_TOKENS = 3000;
const MAX_BUDGET_BYTES = 8 * 1024 * 1024;

export function byteLength(text) {
  return Buffer.byteLength(text, 'utf8');
}

export function estimateTokens(bytes) {
  return Math.ceil(bytes / BYTES_PER_TOKEN);
}

/**
 * Parse "3000", "3000t" (estimated tokens), "12000b", "12kb" or "12kib".
 * @returns {{ unit: 'tokens'|'bytes', value: number, bytes: number }}
 */
export function parseBudget(input) {
  if (input === undefined || input === null || input === '') {
    return { unit: 'tokens', value: DEFAULT_BUDGET_TOKENS, bytes: DEFAULT_BUDGET_TOKENS * BYTES_PER_TOKEN };
  }
  const m = /^(\d+)\s*(t|tok|tokens|b|bytes|kb|kib)?$/i.exec(String(input).trim());
  if (!m) {
    throw usageError('INVALID_BUDGET', `Invalid budget "${input}". Use e.g. 3000 (estimated tokens), 3000t, 12000b or 12kb.`);
  }
  const n = Number(m[1]);
  const suffix = (m[2] ?? 't').toLowerCase();
  const unit = suffix.startsWith('t') ? 'tokens' : 'bytes';
  const bytes = unit === 'tokens' ? n * BYTES_PER_TOKEN : suffix.startsWith('k') ? n * 1024 : n;
  if (n < 1 || bytes > MAX_BUDGET_BYTES) {
    throw usageError('INVALID_BUDGET', `Budget must be between 1 and ${MAX_BUDGET_BYTES} bytes.`);
  }
  return { unit, value: unit === 'tokens' ? n : bytes, bytes };
}

/** Parse a plain byte size such as "1048576", "512kb" or "2mb". */
export function parseByteSize(input, optionName) {
  const m = /^(\d+)\s*(b|kb|kib|mb|mib)?$/i.exec(String(input).trim());
  if (!m) throw usageError('INVALID_SIZE', `Invalid value for ${optionName}: "${input}". Use bytes, e.g. 524288, 512kb or 2mb.`);
  const mult = { b: 1, kb: 1024, kib: 1024, mb: 1048576, mib: 1048576 }[(m[2] ?? 'b').toLowerCase()];
  const bytes = Number(m[1]) * mult;
  if (bytes < 1) throw usageError('INVALID_SIZE', `${optionName} must be at least 1 byte.`);
  return bytes;
}
