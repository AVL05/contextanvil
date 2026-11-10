import { refOf } from '../core/facts.js';

/*
 * Plain-text renderers. Output is ASCII-only on purpose: it displays
 * correctly in legacy Windows console code pages and in CI logs.
 */

const fmtBytes = (n) => (n < 1024 ? `${n} B` : n < 1048576 ? `${(n / 1024).toFixed(1)} KiB` : `${(n / 1048576).toFixed(1)} MiB`);
const plural = (n, word, pluralWord = `${word}s`) => `${n} ${n === 1 ? word : pluralWord}`;

const SCAN_SECTIONS = [
  ['language', 'Languages (by file extension)'],
  ['framework', 'Frameworks and libraries'],
  ['tool', 'Tooling'],
  ['test-framework', 'Test frameworks'],
  ['package-manager', 'Package manager'],
  ['manifest', 'Package manifests'],
  ['entrypoint', 'Entry points'],
  ['script', 'Build and development scripts (never executed)'],
  ['source-dir', 'Significant source directories'],
  ['config', 'Configuration files'],
  ['convention', 'Conventions (evidence-backed)'],
  ['instruction', 'Agent instruction files'],
];

/** JSON-safe view of a scan. File contents and per-file listings are omitted unless requested. */
export function scanToJson(scan, { includeFiles = false } = {}) {
  const { files, documents, ...rest } = scan;
  return {
    ...rest,
    fileCount: files.length,
    ...(includeFiles ? { files } : {}),
    documents: documents.map(({ text, ...meta }) => meta),
  };
}

export function renderScan(scan) {
  const out = [];
  const s = scan.stats;
  const ex = s.excluded;
  out.push(`ContextAnvil scan (v${scan.tool.version})`);
  out.push(`Root: ${scan.root}`);
  out.push(`Indexed ${plural(s.filesIndexed, 'file')} in ${plural(s.directoriesVisited, 'directory', 'directories')} (${fmtBytes(s.bytesIndexed)}).`);
  const excluded = [
    ex.ignored && `${ex.ignored} by ignore rules`,
    ex.defaultDirs && `${ex.defaultDirs} dependency/build/cache dirs`,
    ex.sensitive && `${ex.sensitive} sensitive (never read)`,
    ex.binary && `${ex.binary} binary/media`,
    ex.symlinks && `${ex.symlinks} symlinks not followed`,
    ex.unreadable && `${ex.unreadable} unreadable`,
  ].filter(Boolean);
  out.push(`Excluded: ${excluded.length ? excluded.join(', ') : 'nothing'}.`);
  if (s.truncated) out.push('WARNING: traversal hit the file limit; results are incomplete.');
  out.push('Legend: [status/confidence] source. "observed" = read from a file, "inferred" = heuristic.');

  for (const [kind, title] of SCAN_SECTIONS) {
    const facts = scan.facts.filter((f) => f.kind === kind);
    if (!facts.length) continue;
    out.push('', `${title.toUpperCase()}`);
    for (const f of facts) {
      const ref = refOf(f);
      out.push(`  - ${f.claim}  [${f.status}/${f.confidence}]${ref ? ` ${ref}` : ''}`);
    }
  }
  if (!scan.facts.length) out.push('', 'No facts were detected.');

  const notable = scan.diagnostics.filter((d) => d.level !== 'info');
  const notes = scan.diagnostics.length - notable.length;
  if (notable.length || notes) {
    out.push('', 'DIAGNOSTICS');
    for (const d of notable) out.push(`  - [${d.level}] ${d.message}${d.path ? ` (${d.path}${d.line ? `:${d.line}` : ''})` : ''}`);
    if (notes) out.push(`  - ${plural(notes, 'informational note')} (see --json)`);
  }
  if (scan.sensitiveFiles.length) {
    out.push('', `${plural(scan.sensitiveFiles.length, 'sensitive file')} found and left unread. Run "contextanvil doctor" for details.`);
  }
  return `${out.join('\n')}\n`;
}

const SEV_LABEL = { error: '[error]', warning: '[warn] ', info: '[info] ' };
const CATEGORY_TITLES = {
  missing: 'MISSING OR WEAK CONTEXT',
  conflict: 'CONTRADICTIONS',
  stale: 'OUTDATED REFERENCES',
  unsafe: 'POTENTIALLY UNSAFE',
  scan: 'ANALYSIS LIMITS',
};

export function renderDoctor(report) {
  const out = [];
  const { error, warning, info } = report.summary;
  out.push(`ContextAnvil doctor (v${report.tool.version})`);
  out.push(`Root: ${report.root}`);
  out.push(`Result: ${plural(error, 'error')}, ${plural(warning, 'warning')}, ${plural(info, 'note')}.`);
  if (!report.findings.length) {
    out.push('', 'No problems found.');
    return `${out.join('\n')}\n`;
  }
  for (const category of Object.keys(CATEGORY_TITLES)) {
    const group = report.findings.filter((f) => f.category === category);
    if (!group.length) continue;
    out.push('', CATEGORY_TITLES[category]);
    for (const f of group) {
      out.push(`  ${SEV_LABEL[f.severity]} ${f.title}`);
      if (f.evidence.length) {
        out.push(`          at ${f.evidence.slice(0, 4).map((e) => (e.line ? `${e.path}:${e.line}` : e.path)).join(', ')}${f.evidence.length > 4 ? ', ...' : ''}`);
      }
      for (const e of f.evidence) {
        if (e.excerpt) out.push(`          source (untrusted): ${e.excerpt}`);
      }
      out.push(`          ${f.detail}`);
      if (f.recommendation) out.push(`          fix: ${f.recommendation}`);
    }
  }
  return `${out.join('\n')}\n`;
}
