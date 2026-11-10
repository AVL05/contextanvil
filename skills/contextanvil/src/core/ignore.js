/**
 * Minimal gitignore-compatible matcher (no dependencies, no regular
 * expressions built from user patterns).
 *
 * Patterns come from files inside the scanned repository, so they are hostile
 * input. Matching is done segment by segment with an iterative glob matcher
 * (worst case O(pattern x name)), never by compiling patterns to a regex, so a
 * pattern such as "*a*a*a*a*a*b" cannot cause catastrophic backtracking.
 *
 * Supported: comments, negation (!), directory-only (trailing /), anchoring
 * (leading or inner /), *, ?, [...] classes, ** as a whole path segment,
 * backslash escapes. Not supported: .git/info/exclude and the global excludes
 * file (documented limitation). Pathological patterns are skipped.
 */

const MAX_PATTERN_LENGTH = 1000;
const MAX_SEGMENTS = 40;
const MAX_RULES_PER_FILE = 5000;

/** Compile one path segment into glob tokens. */
function compileSegment(seg) {
  const tokens = [];
  for (let i = 0; i < seg.length; i++) {
    const c = seg[i];
    if (c === '*') {
      if (tokens.at(-1)?.t !== 'star') tokens.push({ t: 'star' });
    } else if (c === '?') {
      tokens.push({ t: 'any' });
    } else if (c === '[') {
      const end = seg.indexOf(']', i + 2);
      if (end === -1) {
        tokens.push({ t: 'lit', c });
      } else {
        let body = seg.slice(i + 1, end);
        let negate = false;
        if (body[0] === '!' || body[0] === '^') {
          negate = true;
          body = body.slice(1);
        }
        const ranges = [];
        for (let j = 0; j < body.length; j++) {
          if (body[j + 1] === '-' && j + 2 < body.length) {
            ranges.push([body[j], body[j + 2]]);
            j += 2;
          } else {
            ranges.push([body[j], body[j]]);
          }
        }
        tokens.push({ t: 'class', negate, ranges });
        i = end;
      }
    } else if (c === '\\' && i + 1 < seg.length) {
      tokens.push({ t: 'lit', c: seg[++i] });
    } else {
      tokens.push({ t: 'lit', c });
    }
  }
  return tokens;
}

function single(token, ch) {
  if (token.t === 'any') return true;
  if (token.t === 'lit') return token.c === ch;
  const inside = token.ranges.some(([lo, hi]) => ch >= lo && ch <= hi);
  return token.negate ? !inside : inside;
}

/** Iterative glob match with single-star backtracking: O(tokens x length). */
function matchSegment(tokens, s) {
  let ti = 0;
  let si = 0;
  let starTi = -1;
  let starSi = 0;
  while (si < s.length) {
    const tk = tokens[ti];
    if (tk && tk.t !== 'star' && single(tk, s[si])) {
      ti++;
      si++;
    } else if (tk && tk.t === 'star') {
      starTi = ti++;
      starSi = si;
    } else if (starTi !== -1) {
      ti = starTi + 1;
      si = ++starSi;
    } else {
      return false;
    }
  }
  while (tokens[ti]?.t === 'star') ti++;
  return ti === tokens.length;
}

/** Match pattern segments (with '**' wildcards) against path segments, memoised. */
function matchPath(pattern, parts) {
  const memo = new Map();
  const go = (pi, si) => {
    const key = pi * 1000 + si;
    if (memo.has(key)) return memo.get(key);
    let result;
    if (pi === pattern.length) {
      result = si === parts.length;
    } else if (pattern[pi] === '**') {
      if (pi === pattern.length - 1) {
        result = si < parts.length; // trailing "/**": everything inside
      } else {
        result = false;
        for (let k = si; k <= parts.length && !result; k++) result = go(pi + 1, k);
      }
    } else {
      result = si < parts.length && matchSegment(pattern[pi], parts[si]) && go(pi + 1, si + 1);
    }
    memo.set(key, result);
    return result;
  };
  return go(0, 0);
}

/** Parse the text of an ignore file into rules. Malformed or pathological patterns are skipped. */
export function parseIgnore(text) {
  const rules = [];
  for (const raw of text.split(/\r?\n/)) {
    if (rules.length >= MAX_RULES_PER_FILE) break;
    if (raw.startsWith('#') || raw.length > MAX_PATTERN_LENGTH) continue;
    let line = raw.replace(/(?<!\\)\s+$/, '');
    if (!line) continue;
    let negated = false;
    if (line.startsWith('!')) {
      negated = true;
      line = line.slice(1);
    } else if (line.startsWith('\\!') || line.startsWith('\\#')) {
      line = line.slice(1);
    }
    let dirOnly = false;
    if (line.endsWith('/')) {
      dirOnly = true;
      line = line.slice(0, -1);
    }
    if (!line) continue;
    const anchored = line.includes('/');
    if (line.startsWith('/')) line = line.slice(1);
    const segments = line.split('/').filter((s) => s !== '');
    if (!segments.length || segments.length > MAX_SEGMENTS) continue;
    const compiled = segments.map((s) => (s === '**' ? '**' : compileSegment(s)));
    // An unanchored pattern may match at any depth: it behaves as if prefixed with "**/".
    rules.push({ negated, dirOnly, pattern: anchored ? compiled : ['**', ...compiled] });
  }
  return rules;
}

/**
 * Evaluate a stack of ignore sources (root first, deepest last).
 * @param {{ base: string, rules: object[] }[]} sources
 * @param {string} rel Posix path relative to the repository root.
 * @param {boolean} isDir
 */
export function isIgnoredBy(sources, rel, isDir) {
  let ignored = false;
  for (const { base, rules } of sources) {
    if (base && !rel.startsWith(`${base}/`)) continue;
    const parts = (base ? rel.slice(base.length + 1) : rel).split('/');
    for (const rule of rules) {
      if (rule.dirOnly && !isDir) continue;
      if (matchPath(rule.pattern, parts)) ignored = !rule.negated;
    }
  }
  return ignored;
}
