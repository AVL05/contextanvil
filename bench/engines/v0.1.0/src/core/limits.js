import { usageError } from '../errors.js';

export const DEFAULT_LIMITS = Object.freeze({
  /** Maximum number of files placed in the index (breadth-first, so shallow files win). */
  maxFiles: 20000,
  /** Maximum directory depth below the root. */
  maxDepth: 25,
  /** Files larger than this are indexed but never read. */
  maxFileBytes: 512 * 1024,
  /** Total bytes ContextAnvil will read from the repository in one run. */
  maxTotalReadBytes: 64 * 1024 * 1024,
  /** Ignore files larger than this are skipped. */
  maxIgnoreFileBytes: 64 * 1024,
});

/** Merge user options over defaults and validate them. */
export function resolveLimits(options = {}) {
  const limits = { ...DEFAULT_LIMITS };
  for (const key of Object.keys(DEFAULT_LIMITS)) {
    if (options[key] === undefined) continue;
    const v = options[key];
    if (!Number.isInteger(v) || v < 1) {
      throw usageError('INVALID_LIMIT', `Option "${key}" must be a positive integer.`);
    }
    limits[key] = v;
  }
  return limits;
}
