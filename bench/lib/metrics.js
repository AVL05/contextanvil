/** Standard ranking metrics over a ranked list of paths and a set of relevant paths. */

export function precisionAtK(ranked, relevant, k) {
  const rel = new Set(relevant);
  const hits = ranked.slice(0, k).filter((p) => rel.has(p)).length;
  return hits / k;
}

export function recallAtK(ranked, relevant, k) {
  const rel = new Set(relevant);
  const hits = ranked.slice(0, k).filter((p) => rel.has(p)).length;
  return hits / rel.size;
}

/** Reciprocal rank of the first relevant file (0 when none is ranked). */
export function reciprocalRank(ranked, relevant) {
  const rel = new Set(relevant);
  const i = ranked.findIndex((p) => rel.has(p));
  return i === -1 ? 0 : 1 / (i + 1);
}

/** Precision at K = number of relevant files; 1.0 means every relevant file is ranked first. */
export function rPrecision(ranked, relevant) {
  return precisionAtK(ranked, relevant, relevant.length);
}

export function mean(values) {
  return values.length ? values.reduce((a, b) => a + b, 0) / values.length : 0;
}

export function median(values) {
  if (!values.length) return 0;
  const s = [...values].sort((a, b) => a - b);
  const mid = Math.floor(s.length / 2);
  return s.length % 2 ? s[mid] : (s[mid - 1] + s[mid]) / 2;
}

export const round = (n, digits = 3) => Math.round(n * 10 ** digits) / 10 ** digits;

/** Rank (1-based) of each relevant file in the list, or null if absent. */
export function ranksOf(ranked, relevant) {
  return Object.fromEntries(relevant.map((p) => {
    const i = ranked.indexOf(p);
    return [p, i === -1 ? null : i + 1];
  }));
}
