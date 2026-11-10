import { parseSections } from '../core/markdown.js';
import { dirname } from '../core/paths.js';
import { neutralize } from '../core/sanitize.js';
import { findSecrets, safeText } from '../core/secrets.js';

export const id = 'instructions';

/** [pattern on the repo-relative path, document type] */
const INSTRUCTION_FILES = [
  [/(^|\/)AGENTS\.md$/i, 'AGENTS.md'],
  [/(^|\/)CLAUDE(\.local)?\.md$/i, 'CLAUDE.md'],
  [/(^|\/)GEMINI\.md$/i, 'GEMINI.md'],
  [/^\.github\/copilot-instructions\.md$/i, 'Copilot instructions'],
  [/^\.github\/instructions\/[^/]+\.instructions\.md$/i, 'Copilot path instructions'],
  [/^\.cursorrules$/, 'Cursor rules'],
  [/^\.cursor\/rules\/[^/]+\.(md|mdc)$/, 'Cursor rules'],
  [/^\.windsurfrules$/, 'Windsurf rules'],
];

export function detect(ctx) {
  const found = ctx.files.filter((f) => INSTRUCTION_FILES.some(([re]) => re.test(f.path)));
  for (const f of found) {
    const type = INSTRUCTION_FILES.find(([re]) => re.test(f.path))[1];
    const meta = ctx.meta(f.path);
    if (!meta) {
      ctx.diag('warn', 'instruction-unreadable', 'Instruction file could not be read (too large, binary, or unreadable)', f.path);
      continue;
    }
    const secretFindings = findSecrets(meta.text);
    const { found: hidden } = neutralize(meta.text);
    const text = safeText(meta.text);
    const { headings, sections } = parseSections(text);
    const scope = /^\.(github|cursor)\//.test(f.path) || f.path.startsWith('.cursorrules') ? '' : dirname(f.path);
    const doc = {
      path: f.path,
      type,
      scope,
      bytes: meta.bytes,
      estimatedTokens: Math.ceil(meta.bytes / 4),
      sha256: meta.sha256.slice(0, 16),
      lines: text.split('\n').length,
      symlinkTo: f.symlinkTo ?? null,
      headings,
      sections,
      secretFindings,
      hiddenCharacters: hidden,
      text,
    };
    ctx.documents.push(doc);
    ctx.addFact({
      kind: 'instruction', id: `instruction:${f.path}`,
      claim: `${type} at ${f.path} (${doc.lines} lines, ~${doc.estimatedTokens} tokens, ${headings.length} headings, applies to ${scope ? `${scope}/` : 'the whole repository'})${f.symlinkTo ? `; symlink to ${f.symlinkTo}` : ''}`,
      evidence: [{ path: f.path }],
      data: { type, scope, estimatedTokens: doc.estimatedTokens, symlinkTo: doc.symlinkTo },
    });
  }
}
