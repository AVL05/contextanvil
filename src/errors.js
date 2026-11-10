import { safeText } from './core/secrets.js';

/** Exit codes used by the CLI. */
export const EXIT = Object.freeze({
  OK: 0,
  FINDINGS: 1,
  USAGE: 2,
  RUNTIME: 3,
});

/**
 * Expected, user-facing failure. Messages must never contain repository
 * file contents.
 */
export class ContextAnvilError extends Error {
  /**
   * @param {string} code Stable machine-readable code.
   * @param {string} message Human-readable message.
   * @param {{ exitCode?: number }} [options]
   */
  constructor(code, message, { exitCode = EXIT.RUNTIME } = {}) {
    super(safeText(message));
    this.name = 'ContextAnvilError';
    this.code = code;
    this.exitCode = exitCode;
  }
}

export function usageError(code, message) {
  return new ContextAnvilError(code, message, { exitCode: EXIT.USAGE });
}
