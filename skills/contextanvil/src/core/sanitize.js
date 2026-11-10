/**
 * Neutralisation of characters that are invisible, direction-changing or that
 * a terminal would interpret. Text from scanned repositories is untrusted: an
 * ESC sequence in a file would otherwise be able to rewrite what the user sees,
 * and a zero-width character can hide an instruction from a reviewer.
 *
 * Tabs and LF or CRLF line endings are left alone in prose.
 */

// C0 controls (except \t \n \r), DEL, C1 controls, soft hyphen, combining grapheme joiner, Arabic letter mark,
// Hangul/Khmer/Mongolian fillers, zero-width and bidi controls, invisible operators, braille blank,
// BOM / zero-width no-break space, halfwidth Hangul filler, and the Unicode "tag" block.
const UNSAFE = /\r(?!\n)|[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f-\u009f­͏؜ᅟᅠ឴឵᠎​-‏‪-‮⁠-⁯⠀ㅤ﻿ﾠ\u{e0000}-\u{e007f}]/gu;
const CONTROL = /[\u0000-\u0008\u000b-\u001f\u007f-\u009f]/u;
const PATH_WHITESPACE = /[\r\n\t]/;

export function codepointLabel(ch) {
  return `U+${ch.codePointAt(0).toString(16).toUpperCase().padStart(4, '0')}`;
}

/** True for C0/C1 control characters, which can drive a terminal. */
export function isTerminalControl(ch) {
  return CONTROL.test(ch);
}

export function hasUnsafeCharacters(text) {
  UNSAFE.lastIndex = 0;
  return UNSAFE.test(text);
}

export function hasUnsafePathCharacters(text) {
  return PATH_WHITESPACE.test(text) || hasUnsafeCharacters(text);
}

/**
 * Replace every unsafe character with a visible `<U+XXXX>` marker.
 * @returns {{ text: string, found: { line: number, codepoint: string, control: boolean }[] }}
 */
export function neutralize(text) {
  const found = [];
  let line = 1;
  let last = 0;
  UNSAFE.lastIndex = 0;
  for (let m = UNSAFE.exec(text); m !== null; m = UNSAFE.exec(text)) {
    for (let i = last; i < m.index; i++) if (text.charCodeAt(i) === 10) line++;
    last = m.index;
    found.push({ line, codepoint: codepointLabel(m[0]), control: isTerminalControl(m[0]) });
  }
  if (!found.length) return { text, found };
  return { text: text.replace(UNSAFE, (ch) => `<${codepointLabel(ch)}>`), found };
}

/** Escape unsafe characters in a short string such as a file name, for use in a message. */
export function escapeUnsafe(text) {
  const escape = (ch) => `\\u{${ch.codePointAt(0).toString(16)}}`;
  return text.replace(UNSAFE, escape).replace(/[\r\n\t]/g, escape);
}

/** Recursively neutralise strings in plain data (used for fact payloads). */
export function neutralizeDeep(value, transform = (s) => neutralize(s).text, depth = 0) {
  if (typeof value === 'string') return transform(value);
  if (depth > 6 || value === null || typeof value !== 'object') return value;
  if (Array.isArray(value)) return value.map((v) => neutralizeDeep(v, transform, depth + 1));
  const out = {};
  for (const [k, v] of Object.entries(value)) out[k] = neutralizeDeep(v, transform, depth + 1);
  return out;
}
