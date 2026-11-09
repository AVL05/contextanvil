import { classifyFile } from '../core/classify.js';
import { basename, dirname } from '../core/paths.js';
import { matchTerm, splitWords } from './terms.js';

const CATEGORY_WEIGHT = { source: 1, test: 0.7, doc: 0.8, config: 0.8 };

const round2 = (n) => Math.round(n * 100) / 100;

function stemOfFile(rel) {
  return basename(rel).replace(/\.(test|spec)(?=\.)/i, '').replace(/\.[^.]+$/, '');
}

/**
 * Score one file against the task. Transparent by construction: every point of
 * score is attached to a human-readable reason.
 *
 * | signal                                   | exact | prefix |
 * |------------------------------------------|-------|--------|
 * | file name token matches a term           | +4    | +2.5   |
 * | directory name token matches a term      | +1.5  | +1     |
 * | exported symbol token matches a term     | +3    | +2     |
 * | file content mentions a term (max +1.5)  | +0.5 each        |
 * | each additional term matched by location | +1.5             |
 * | file explicitly named in the task        | +10              |
 *
 * Test, doc and config files are multiplied by 0.7 / 0.8 / 0.8.
 *
 * @param {string} rel
 * @param {string[]} terms
 * @param {{ symbols: object[], lower: string }|undefined} analysis
 * @param {boolean} mentioned
 */
export function scoreFile(rel, terms, analysis, mentioned) {
  const { category } = classifyFile(rel);
  const nameTokens = splitWords(stemOfFile(rel));
  const dirTokens = dirname(rel).split('/').filter(Boolean).flatMap((seg) => splitWords(seg).map((t) => ({ t, seg })));
  const reasons = [];
  let score = 0;
  let located = 0;
  let contentPoints = 0;

  if (mentioned) {
    score += 10;
    reasons.push({ kind: 'mentioned', detail: 'file is named in the task', points: 10 });
  }

  for (const term of terms) {
    let best = null; // strongest location-based match for this term
    const consider = (points, kind, detail) => {
      if (!best || points > best.points) best = { points, kind, detail };
    };
    for (const tok of nameTokens) {
      const m = matchTerm(term, tok);
      if (m) consider(m === 'exact' ? 4 : 2.5, 'filename', `file name "${basename(rel)}" matches "${term}" (${m})`);
    }
    for (const { t, seg } of dirTokens) {
      const m = matchTerm(term, t);
      if (m) consider(m === 'exact' ? 1.5 : 1, 'directory', `directory "${seg}" matches "${term}" (${m})`);
    }
    for (const sym of analysis?.symbols ?? []) {
      for (const tok of splitWords(sym.name)) {
        const m = matchTerm(term, tok);
        if (m) consider(m === 'exact' ? 3 : 2, 'symbol', `${sym.kind} ${sym.name} (line ${sym.line}) matches "${term}" (${m})`);
      }
    }
    if (best) {
      score += best.points;
      located++;
      reasons.push({ kind: best.kind, detail: best.detail, points: best.points });
    }
    if (analysis && term.length >= 3 && contentPoints < 1.5 && analysis.lower.includes(term)) {
      contentPoints += 0.5;
      score += 0.5;
      reasons.push({ kind: 'content', detail: `content mentions "${term}"`, points: 0.5 });
    }
  }

  if (located > 1) {
    const bonus = (located - 1) * 1.5;
    score += bonus;
    reasons.push({ kind: 'coverage', detail: `matches ${located} of ${terms.length} task terms by name, directory or symbol`, points: bonus });
  }

  const weight = CATEGORY_WEIGHT[category] ?? 1;
  if (weight !== 1 && score > 0) {
    reasons.push({ kind: 'category', detail: `${category} file weight x${weight}`, points: 0 });
    score *= weight;
  }
  return { score: round2(score), reasons, category };
}

/** Test files that pair with `rel` by name or by importing it. */
export function findRelated(rel, scan, analyses) {
  const related = [];
  const stem = stemOfFile(rel).toLowerCase();
  for (const f of scan.files) {
    if (f.path === rel) continue;
    const { category } = classifyFile(f.path);
    const a = analyses.get(f.path);
    if (category === 'test') {
      if (stemOfFile(f.path).toLowerCase() === stem) related.push({ path: f.path, relation: 'test (same base name)' });
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
