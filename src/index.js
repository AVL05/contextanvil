/**
 * ContextAnvil public API.
 *
 * Every function is synchronous, side-effect free with respect to the
 * scanned repository, and returns plain JSON-serialisable data. A future CLI
 * wrapper, MCP server or dashboard should call these and nothing deeper.
 */
export { scanRepository, SCHEMA_VERSION as SCAN_SCHEMA_VERSION } from './scanner.js';
export { compileContext, PACK_SCHEMA_VERSION } from './compiler/compile.js';
export { diagnose, exceedsThreshold, DOCTOR_SCHEMA_VERSION } from './doctor.js';
export { parseBudget, estimateTokens } from './compiler/budget.js';
export { DEFAULT_LIMITS } from './core/limits.js';
export { redact, findSecrets } from './core/secrets.js';
export { ContextAnvilError, EXIT } from './errors.js';
export { VERSION } from './version.js';
