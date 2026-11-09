import * as languages from './languages.js';
import * as node from './node.js';
import * as php from './php.js';
import * as configFiles from './config-files.js';
import * as structure from './structure.js';
import * as conventions from './conventions.js';
import * as instructions from './instructions.js';

/**
 * Detector registry. A detector is `{ id, detect(ctx) }`; to support a new
 * ecosystem, add a module here. Order matters: later detectors may read
 * `ctx.shared` values (frameworks, package manager) set by earlier ones.
 */
export const DETECTORS = Object.freeze([languages, node, php, configFiles, structure, conventions, instructions]);
