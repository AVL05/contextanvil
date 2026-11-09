import { byCodeUnit } from '../core/paths.js';
import { neutralize, neutralizeDeep } from '../core/sanitize.js';
import { redact } from '../core/secrets.js';
import { buildRelationships } from './relationships.js';

const LIMIT = 64;
const sortScore = (a, b) => b.score - a.score || byCodeUnit(a.path, b.path);

/** Baseline lexical order is also the baseline candidate order. */
export function retrieve(lexical, analyses, task, enabled) {
  const positive = lexical.filter((file) => file.score > 0);
  if (!enabled) return { candidates: positive.slice(0, LIMIT), ranked: positive };

  const byPath = new Map(lexical.map((file) => [file.path, file]));
  const graph = buildRelationships(analyses, byPath);
  const direct = new Map();
  for (const word of task.toLowerCase().split(/[^a-z0-9_$]/)) {
    const posting = graph.symbols.get(word);
    if (word.length < 4 || !posting || posting.length !== 1) continue;
    const { path, line } = posting[0];
    direct.set(path, { kind: 'identifier', points: 5, detail: 'Unique declaration matches task identifier', evidence: { path, line } });
  }
  const adjusted = lexical.map((file) => {
    const reasons = [...file.reasons];
    let score = file.score;
    if (graph.barrels.has(file.path) && !reasons.some((r) => r.kind === 'mentioned')) {
      reasons.push({ kind: 'barrel', points: -score / 2, detail: 'Discount for re-export-only module' });
      score /= 2;
    }
    const exact = direct.get(file.path);
    if (exact) {
      score += exact.points;
      reasons.push(exact);
    }
    return { ...file, score, reasons };
  }).sort(sortScore);
  const seeds = adjusted.filter((file) => file.score >= 3.5 && !graph.barrels.has(file.path)).slice(0, 24);
  const supports = new Map();
  for (const seed of seeds) {
    const queue = [{ to: seed.path, trail: [] }];
    const visited = new Set([seed.path]);
    for (const { to, trail } of queue) {
      for (const link of (graph.adjacency.get(to) ?? []).slice(0, 8)) {
        if (visited.has(link.to)) continue;
        visited.add(link.to);
        const next = [...trail, link.edge];
        const points = link.weight * (link.edge.confidence === 'high' ? 1 : 0.8) / next.length;
        if (!supports.has(link.to) || supports.get(link.to).points < points) {
          supports.set(link.to, { kind: 'graph', points, detail: `Related to ${seed.path} via ${next.map((edge) => edge.type).join(' / ')}`, trail: next });
        }
        if (trail.length === 0 && (link.edge.type === 'route-handler' || graph.barrels.has(link.to))
          && (graph.adjacency.get(link.to)?.length ?? 0) <= 8) queue.push({ to: link.to, trail: next });
      }
    }
  }

  // Reserve capacity for structural candidates, then backfill unused slots.
  const candidates = new Set(adjusted.filter((f) => f.score > 0).slice(0, 48).map((f) => f.path));
  const neighbors = [...supports].sort(([a, x], [b, y]) => y.points - x.points || byCodeUnit(a, b));
  for (const path of [...neighbors.map(([path]) => path), ...adjusted.filter((f) => f.score > 0).map((f) => f.path)]) {
    if (candidates.size >= LIMIT) break;
    candidates.add(path);
  }
  const ranked = adjusted.filter((file) => candidates.has(file.path)).map((file) => {
    const support = supports.get(file.path);
    if (!support) return file;
    const points = graph.barrels.has(file.path) ? Math.min(1, support.points) : support.points;
    const reason = neutralizeDeep({ ...support, points }, (value) => neutralize(redact(value)).text);
    return { ...file, score: Math.round((file.score + points) * 100) / 100, reasons: [...file.reasons, reason] };
  }).sort(sortScore);
  return {
    candidates: [...candidates].map((path) => byPath.get(path)),
    ranked,
    index: { edges: graph.edgeCount, capped: graph.capped, truncatedFiles: graph.truncatedFiles },
  };
}
