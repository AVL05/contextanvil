import { neutralize, neutralizeDeep } from './sanitize.js';
import { redact } from './secrets.js';

/** Every string that originates in a scanned file passes through this before it can be shown. */
const clean = (s) => redact(neutralize(String(s)).text);

/**
 * A fact is the unit of knowledge ContextAnvil reports.
 *
 * status:
 *   observed  read directly from a file ("package.json declares react ^18")
 *   inferred  derived by a deterministic heuristic from observations
 * confidence: high | medium | low
 * evidence:   where it was detected ({ path, line?, excerpt? })
 * freshness:  digest of the primary source file at scan time, so a later
 *             run can tell whether the fact's source has changed.
 */

export const KIND_ORDER = [
  'language', 'framework', 'tool', 'test-framework', 'package-manager', 'manifest',
  'entrypoint', 'script', 'source-dir', 'config', 'convention', 'instruction',
];

const STATUSES = new Set(['observed', 'inferred']);
const CONFIDENCES = new Set(['high', 'medium', 'low']);

function cleanExcerpt(text) {
  if (text === undefined || text === null) return undefined;
  const oneLine = redact(String(text)).replace(/\s+/g, ' ').trim();
  return oneLine.length > 160 ? `${oneLine.slice(0, 157)}...` : oneLine;
}

export function createFact({ kind, id, claim, status = 'observed', confidence = 'high', evidence = [], data = {}, freshness = null }) {
  if (!KIND_ORDER.includes(kind)) throw new Error(`Unknown fact kind: ${kind}`);
  if (!STATUSES.has(status)) throw new Error(`Unknown fact status: ${status}`);
  if (!CONFIDENCES.has(confidence)) throw new Error(`Unknown confidence: ${confidence}`);
  const ev = evidence.map((e) => {
    const out = { path: neutralize(e.path).text };
    if (e.line !== undefined) out.line = e.line;
    const excerpt = cleanExcerpt(e.excerpt);
    if (excerpt) out.excerpt = excerpt;
    return out;
  });
  return {
    id: clean(id),
    kind,
    claim: clean(claim),
    status,
    confidence,
    source: ev[0]?.path ?? null,
    evidence: ev,
    freshness,
    data: neutralizeDeep(data, clean),
  };
}

/** Human-readable "path:line" reference for a fact's primary evidence. */
export function refOf(fact) {
  const e = fact.evidence[0];
  if (!e) return '';
  return e.line ? `${e.path}:${e.line}` : e.path;
}
