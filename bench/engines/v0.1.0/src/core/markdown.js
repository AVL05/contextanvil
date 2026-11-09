/**
 * Tiny Markdown helpers. Not a full parser: just enough structure to cite
 * "path:line" ranges for instruction files.
 */

const FENCE = /^ {0,3}(```+|~~~+)/;
const HEADING = /^ {0,3}(#{1,6})\s+(.+?)\s*#*\s*$/;

/** Yield every line with its 1-based number and whether it is inside a fenced block. */
export function* lines(text) {
  const all = text.split(/\r?\n/);
  let fence = null;
  for (let i = 0; i < all.length; i++) {
    const raw = all[i];
    const m = FENCE.exec(raw);
    let inFence = fence !== null;
    if (m) {
      if (fence === null) {
        fence = m[1][0];
        inFence = true;
      } else if (m[1][0] === fence) {
        fence = null;
      }
    }
    yield { number: i + 1, text: raw, inFence };
  }
}

/**
 * Split a document into flat sections, one per heading, plus an optional
 * preamble. Each section carries a breadcrumb and an inclusive line range.
 */
export function parseSections(text) {
  const all = text.split(/\r?\n/);
  const headings = [];
  for (const l of lines(text)) {
    if (l.inFence) continue;
    const m = HEADING.exec(l.text);
    if (m) headings.push({ level: m[1].length, title: m[2].trim(), line: l.number });
  }

  const sections = [];
  const total = all.length;
  const firstHeadingLine = headings.length ? headings[0].line : total + 1;
  if (all.slice(0, firstHeadingLine - 1).some((s) => s.trim() !== '')) {
    sections.push({ title: '(preamble)', breadcrumb: [], level: 0, startLine: 1, endLine: firstHeadingLine - 1 });
  }
  const stack = [];
  headings.forEach((h, i) => {
    while (stack.length && stack[stack.length - 1].level >= h.level) stack.pop();
    stack.push(h);
    sections.push({
      title: h.title,
      breadcrumb: stack.map((s) => s.title),
      level: h.level,
      startLine: h.line,
      endLine: (headings[i + 1]?.line ?? total + 1) - 1,
    });
  });
  // Trim trailing blank lines from each range.
  for (const s of sections) {
    while (s.endLine > s.startLine && all[s.endLine - 1].trim() === '') s.endLine--;
  }
  return { headings, sections };
}

/** Return the text of an inclusive 1-based line range. */
export function sliceLines(text, startLine, endLine) {
  return text.split(/\r?\n/).slice(startLine - 1, endLine).join('\n');
}

/**
 * Inline code spans and Markdown link targets outside fenced blocks.
 * @returns {{ value: string, line: number, via: 'code'|'link' }[]}
 */
export function extractInlineReferences(text) {
  const refs = [];
  for (const l of lines(text)) {
    if (l.inFence) continue;
    for (const m of l.text.matchAll(/`([^`\n]+)`/g)) refs.push({ value: m[1].trim(), line: l.number, via: 'code' });
    for (const m of l.text.matchAll(/\]\(([^)\s]+)\)/g)) refs.push({ value: m[1].trim(), line: l.number, via: 'link' });
  }
  return refs;
}
