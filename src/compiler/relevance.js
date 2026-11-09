import { classifyFile } from '../core/classify.js';
import { basename, dirname } from '../core/paths.js';
import { ROLE_WORDS, rolesOf } from './roles.js';
import { INTENT_WEIGHTS, matchTerm, splitWords, stem } from './terms.js';

const round2 = (n) => Math.round(n * 100) / 100;

/** Base points for the best location-based match of one term. */
const LOCATION_POINTS = {
  filename: { exact: 4, prefix: 2.5, root: 2 },
  directory: { exact: 1.5, prefix: 1, root: 0.8 },
  symbol: { exact: 3, prefix: 2, root: 1.5 },
};
const IDF_STRENGTH = 0.5; // how strongly rare terms outweigh common ones
const ROLE_POINTS = 1.5;
const MENTIONED_POINTS = 10;
const CONTENT_CAP = 3;
const DISTINCTIVE_SHARE = 0.2; // a term found in at most 20% of files is distinctive
const DISTINCTIVE_POINTS = 1.5;
const REGISTRY_POINTS = 2;
const TEST_OF_TOP_POINTS = 1.5;
const CONSUMER_POINTS = 1;
const DEPENDENCY_POINTS = 0.5;
const RELATION_CAP = 2;
const STRONG_SCORE = 3.5;

function stemOfFile(rel) {
  return basename(rel).replace(/\.(test|spec)(?=\.)/i, '').replace(/\.[^.]+$/, '');
}

/** Inverse-document-frequency style weight: rare terms count more (1.0 to 2.5, in practice about 1.0 to 1.7). */
export function termWeight(documentFrequency, total) {
  return round2(Math.min(2.5, Math.max(1, 1 + IDF_STRENGTH * Math.log10((total + 1) / (documentFrequency + 1)))));
}

/**
 * Rank candidate files for a task. Everything is additive and every point has
 * a stored reason, so the result can always be explained:
 *
 * | signal                                         | exact | prefix | root |
 * |------------------------------------------------|-------|--------|------|
 * | file name token matches a term                 | 4     | 2.5    | 2    |
 * | directory name token matches a term            | 1.5   | 1      | 0.8  |
 * | declared symbol (function, class, const) match | 3     | 2      | 1.5  |
 *
 * Each term's location points are multiplied by its weight (rarer terms weigh
 * more: weight = 1 + 0.5 * log10((files + 1) / (files matching + 1)), between 1 and 2.5).
 * Further signals:
 *  - content mentions: 1 point per term (1.5 with 3+ occurrences) times the weight, capped at 3 per file
 *  - +1 per extra distinct term matched
 *  - +1.5 per task word that names the file's structural role (at most 2 words; see roles.js)
 *  - +1.5 x weight per distinctive term (found in at most 20% of files), counted only when the
 *    file also matches another term
 *  - +10 for a file named in the task
 * The total is then multiplied by an intent-dependent factor per file category (see terms.js).
 * A second pass adds relation evidence from the strongest candidates:
 * registries that register matching modules (add tasks), tests of a top
 * candidate, and direct importers / dependencies of a top candidate.
 *
 * @param {object} input
 * @param {{ path: string, size: number }[]} input.candidates
 * @param {string[]} input.terms
 * @param {string[]} [input.mentioned]
 * @param {{ name: string }} input.intent
 * @param {Map<string, object>} input.analyses Per-file symbols, imports and term counts (may be empty).
 * @returns {{ ranked: object[], termInfo: object[] }} All candidates sorted by score then path.
 */
export function rankFiles({ candidates, terms, mentioned = [], intent, analyses }) {
  const total = Math.max(candidates.length, 1);
  const infos = candidates.map(({ path: rel, size }) => {
    const { category } = classifyFile(rel);
    return {
      path: rel, size, category, analysis: analyses.get(rel),
      nameTokens: splitWords(stemOfFile(rel)),
      dirTokens: dirname(rel).split('/').filter(Boolean).flatMap((seg) => splitWords(seg).map((t) => ({ t, seg }))),
      roles: rolesOf(rel),
    };
  });

  // Best location match per (file, term).
  const location = infos.map((info) => terms.map((term) => {
    let best = null;
    const consider = (kind, m, detail, brief) => {
      const points = LOCATION_POINTS[kind][m];
      if (!best || points > best.points) best = { kind, points, detail, brief };
    };
    for (const tok of info.nameTokens) {
      const m = matchTerm(term, tok);
      if (m) consider('filename', m, `file name "${basename(info.path)}" matches "${term}" (${m})`, `name matches "${term}"`);
    }
    for (const { t, seg } of info.dirTokens) {
      const m = matchTerm(term, t);
      if (m) consider('directory', m, `directory "${seg}" matches "${term}" (${m})`, `dir ${seg}/ matches "${term}"`);
    }
    for (const sym of info.analysis?.symbols ?? []) {
      for (const tok of splitWords(sym.name)) {
        const m = matchTerm(term, tok);
        if (m) consider('symbol', m, `${sym.kind} ${sym.name} (line ${sym.line}) matches "${term}" (${m})`, `symbol ${sym.name} matches "${term}"`);
      }
    }
    return best;
  }));

  // Term weights from document frequency over path, symbol and content evidence.
  const termInfo = terms.map((term, ti) => {
    const df = infos.reduce((n, info, fi) => n + (location[fi][ti] || info.analysis?.hits[term] ? 1 : 0), 0);
    return { term, files: df, weight: termWeight(df, total) };
  });

  const intentWeights = INTENT_WEIGHTS[intent.name] ?? INTENT_WEIGHTS.modify;
  const scored = infos.map((info, fi) => {
    const reasons = [];
    let score = 0;
    let contentPoints = 0;
    const matched = [];
    if (mentioned.includes(info.path)) {
      score += MENTIONED_POINTS;
      reasons.push({ kind: 'mentioned', detail: 'file is named in the task', brief: 'named in the task', points: MENTIONED_POINTS });
    }
    terms.forEach((term, ti) => {
      const { weight, files } = termInfo[ti];
      const loc = location[fi][ti];
      const count = info.analysis?.hits[term] ?? 0;
      if (loc) {
        const points = round2(loc.points * weight);
        score += points;
        reasons.push({ kind: loc.kind, detail: loc.detail, brief: loc.brief, points });
      }
      if (count && contentPoints < CONTENT_CAP) {
        const points = round2(Math.min(CONTENT_CAP - contentPoints, (count >= 3 ? 1.5 : 1) * weight));
        contentPoints += points;
        score += points;
        reasons.push({ kind: 'content', detail: `content mentions "${term}" (${count >= MAX_SHOWN ? `${MAX_SHOWN}+` : count}x; term occurs in ${files} of ${total} files)`, brief: `content "${term}" x${count} (${files}/${total} files)`, points });
      }
      if (loc || count) matched.push(ti);
    });
    // A distinctive term only counts as evidence when the file also matches another term.
    if (matched.length > 1) {
      for (const ti of matched) {
        const { term, files, weight } = termInfo[ti];
        if (files / total > DISTINCTIVE_SHARE) continue;
        const points = round2(DISTINCTIVE_POINTS * weight);
        score += points;
        reasons.push({ kind: 'distinctive', detail: `"${term}" is distinctive (in only ${files} of ${total} files) and this file also matches other task terms`, brief: `"${term}" is distinctive`, points });
      }
    }
    const distinct = matched.length;
    if (distinct > 1) {
      const points = Math.min(4, distinct - 1);
      score += points;
      reasons.push({ kind: 'coverage', detail: `matches ${distinct} of ${terms.length} task terms`, brief: `${distinct}/${terms.length} terms`, points });
    }
    for (const role of info.roles) {
      const triggers = terms.filter((t) => ROLE_WORDS[role]?.some((w) => matchTerm(t, w) === 'exact'));
      if (triggers.length && score > 0) {
        const points = ROLE_POINTS * Math.min(2, triggers.length);
        score += points;
        reasons.push({ kind: 'role', detail: `role "${role}" from project structure; task mentions ${triggers.map((x) => `"${x}"`).join(', ')}`, brief: `role ${role} (${triggers.join(', ')})`, points });
        break;
      }
    }
    const factor = intentWeights[info.category] ?? 1;
    if (factor !== 1 && score > 0) {
      reasons.push({ kind: 'intent', detail: `task intent "${intent.name}": ${info.category} files x${factor}`, brief: `${intent.name} intent x${factor}`, points: 0 });
      score *= factor;
    }
    return { ...info, score, reasons };
  });

  // Second pass: relation evidence derived from the first-pass strongest candidates.
  const byScore = (a, b) => b.score - a.score || (a.path < b.path ? -1 : a.path > b.path ? 1 : 0);
  const firstPass = [...scored].sort(byScore);
  const top = firstPass.filter((f) => f.score >= STRONG_SCORE).slice(0, 3);
  const topPaths = new Set(top.map((f) => f.path));
  const boosts = new Map();
  const boost = (file, points, kind, detail) => {
    const entry = boosts.get(file.path) ?? { total: 0, reasons: [] };
    const room = RELATION_CAP - entry.total;
    if (room <= 0) return;
    const given = Math.min(room, points);
    entry.total += given;
    entry.reasons.push({ kind, detail, brief: detail, points: given });
    boosts.set(file.path, entry);
  };
  for (const file of scored) {
    if (topPaths.has(file.path)) continue;
    const imports = file.analysis?.imports ?? [];
    for (const t of top) {
      const tImports = t.analysis?.imports ?? [];
      if (file.category === 'test' && (stemOfFile(file.path).toLowerCase() === stemOfFile(t.path).toLowerCase() || imports.includes(t.path))) {
        boost(file, TEST_OF_TOP_POINTS, 'relation', `tests top candidate ${t.path}`);
      } else if (file.score > 0 && imports.includes(t.path)) {
        boost(file, CONSUMER_POINTS, 'relation', `imports top candidate ${t.path}`);
      } else if (file.score > 0 && tImports.includes(file.path)) {
        boost(file, DEPENDENCY_POINTS, 'relation', `imported by top candidate ${t.path}`);
      }
    }
  }
  if (intent.name === 'add') {
    // A registry is a module that imports several siblings from its own directory: the extension point for additions.
    for (const file of scored) {
      const imports = file.analysis?.imports ?? [];
      const siblings = imports.filter((p) => dirname(p) === dirname(file.path));
      if (siblings.length < 3) continue;
      const dirMatches = file.dirTokens.some(({ t }) => terms.some((term) => matchTerm(term, t)));
      const memberMatches = siblings.some((p) => (scored.find((s) => s.path === p)?.score ?? 0) > 0);
      if (dirMatches || memberMatches) {
        boost(file, REGISTRY_POINTS, 'registry', `registers ${siblings.length} sibling modules in ${dirname(file.path) || '.'}/ (extension point for additions)`);
      }
    }
  }
  const ranked = scored.map((f) => {
    const b = boosts.get(f.path);
    return b ? { ...f, score: f.score + b.total, reasons: [...f.reasons, ...b.reasons] } : f;
  }).map((f) => ({ ...f, score: round2(f.score) }));
  ranked.sort(byScore);
  return { ranked, termInfo };
}

const MAX_SHOWN = 20;

/** Tests that pair with `rel` by name or by importing it, plus direct importers and dependencies. */
export function findRelated(rel, scan, analyses) {
  const related = [];
  const stem0 = stemOfFile(rel).toLowerCase();
  for (const f of scan.files) {
    if (f.path === rel) continue;
    const { category } = classifyFile(f.path);
    const a = analyses.get(f.path);
    if (category === 'test') {
      if (stemOfFile(f.path).toLowerCase() === stem0) related.push({ path: f.path, relation: 'test (same base name)' });
      else if (a?.imports.includes(rel)) related.push({ path: f.path, relation: 'test (imports it)' });
    } else if (a?.imports.includes(rel)) {
      related.push({ path: f.path, relation: 'imports it' });
    }
  }
  for (const imp of analyses.get(rel)?.imports ?? []) related.push({ path: imp, relation: 'imported by it' });
  const seen = new Set();
  const rank = (r) => (r.relation.startsWith('test') ? 0 : r.relation === 'imports it' ? 1 : 2);
  return related
    .filter((r) => (seen.has(r.path) ? false : seen.add(r.path)))
    .sort((a, b) => rank(a) - rank(b))
    .slice(0, 4);
}

export { stem };
