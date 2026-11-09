/**
 * Minimal gitignore-compatible matcher (no dependencies).
 *
 * Supported: comments, negation (!), directory-only (trailing /), anchoring
 * (leading or inner /), *, ?, [...] classes, ** in all gitignore positions,
 * backslash escapes. Not supported: .git/info/exclude and the global
 * excludes file (documented limitation).
 */

function escapeRegex(ch) {
  return ch.replace(/[.*+?^${}()|[\]\\/]/g, '\\$&');
}

function globToRegex(pattern, anchored) {
  let re = '';
  for (let i = 0; i < pattern.length; i++) {
    const c = pattern[i];
    if (c === '*') {
      if (pattern[i + 1] === '*') {
        let j = i;
        while (pattern[j + 1] === '*') j++;
        const atSegmentStart = i === 0 || pattern[i - 1] === '/';
        if (atSegmentStart && pattern[j + 1] === '/') {
          re += '(?:.*/)?';
          i = j + 1;
        } else if (atSegmentStart && j + 1 === pattern.length) {
          re += '.*';
          i = j;
        } else {
          re += '[^/]*';
          i = j;
        }
      } else {
        re += '[^/]*';
      }
    } else if (c === '?') {
      re += '[^/]';
    } else if (c === '[') {
      const end = pattern.indexOf(']', i + 2);
      if (end === -1) {
        re += '\\[';
      } else {
        let cls = pattern.slice(i + 1, end);
        if (cls.startsWith('!')) cls = `^${cls.slice(1)}`;
        re += `[${cls.replace(/\\/g, '\\\\')}]`;
        i = end;
      }
    } else if (c === '\\' && i + 1 < pattern.length) {
      re += escapeRegex(pattern[++i]);
    } else {
      re += escapeRegex(c);
    }
  }
  return new RegExp(anchored ? `^${re}$` : `^(?:.*/)?${re}$`);
}

/** Parse the text of an ignore file into rules. Malformed patterns are skipped. */
export function parseIgnore(text) {
  const rules = [];
  for (const raw of text.split(/\r?\n/)) {
    if (raw.startsWith('#')) continue;
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
    try {
      rules.push({ negated, dirOnly, regex: globToRegex(line, anchored) });
    } catch {
      // A pattern that cannot be compiled is ignored rather than aborting the scan.
    }
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
    const sub = base ? rel.slice(base.length + 1) : rel;
    for (const rule of rules) {
      if (rule.dirOnly && !isDir) continue;
      if (rule.regex.test(sub)) ignored = !rule.negated;
    }
  }
  return ignored;
}
