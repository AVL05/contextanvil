import path from 'node:path';
import { ContextAnvilError, usageError } from '../errors.js';
import { refOf } from '../core/facts.js';
import { byCodeUnit } from '../core/paths.js';
import { sliceLines } from '../core/markdown.js';
import { safeText } from '../core/secrets.js';
import { readerFor } from '../scanner.js';
import { TOOL_NAME, VERSION } from '../version.js';
import { analyzeFiles, isScorable } from './analyze.js';
import { byteLength, estimateTokens, parseBudget } from './budget.js';
import { findRelated, rankFiles } from './relevance.js';
import { classifyIntent, extractTaskTerms, matchTerm, splitWords } from './terms.js';

export const PACK_SCHEMA_VERSION = 1;

const BASELINE_HEADING = /(command|script|build|test|lint|style|convention|guideline|architecture|structure|workflow|setup|development|rule|principle|security)/i;
const fmtKiB = (n) => (n < 1024 ? `${n} B` : `${(n / 1024).toFixed(1)} KiB`);
const shortHash = (h) => (h ? h.slice(0, 8) : 'n/a');

function bracket(fact) {
  const ref = refOf(fact);
  return `[${ref ? `${ref}; ` : ''}${fact.status}/${fact.confidence}]`;
}

/** Truncate an excerpt on a line boundary and say so, so a cut is never silent. */
function truncateExcerpt(text, maxBytes) {
  if (byteLength(text) <= maxBytes) return { text, cut: 0 };
  const all = text.split('\n');
  const kept = [];
  let used = 0;
  for (const line of all) {
    const n = byteLength(line) + 1;
    if (used + n > maxBytes && kept.length > 0) break;
    kept.push(line);
    used += n;
  }
  return { text: kept.join('\n'), cut: all.length - kept.length };
}

function packageRunner(pm, name) {
  if (!pm) return null;
  if (pm === 'yarn') return `yarn ${name}`;
  return `${pm} run ${name}`;
}

/**
 * Compile a focused, source-grounded context pack for a task.
 *
 * Pure with respect to the repository: it reads only through the scan's safe
 * reader, performs no network or model calls, and for unchanged inputs always
 * returns the same pack (no timestamps, no randomness, code-unit ordering).
 *
 * @param {object} scan Result of scanRepository().
 * @param {string} task Free-text description of the work.
 * @param {{ budget?: string|number, top?: number, maxContentFiles?: number }} [options]
 */
export function compileContext(scan, task, options = {}) {
  if (typeof task !== 'string' || task.trim() === '') {
    throw usageError('EMPTY_TASK', 'A task description is required, e.g. contextanvil context "Update the navigation component".');
  }
  const budget = parseBudget(options.budget);
  const top = options.top ?? 8;
  if (!Number.isInteger(top) || top < 1 || top > 50) throw usageError('INVALID_TOP', '--top must be an integer between 1 and 50.');

  const reader = readerFor(scan);
  const fileSet = new Set(scan.files.map((f) => f.path));
  const safeTask = safeText(task.trim());
  const taskInfo = extractTaskTerms(safeTask, fileSet);
  const { terms, mentionedPaths } = taskInfo;

  // 1. Order candidate files by path-only relevance so the bounded content pass reads likely files first
  //    (smaller files first among the rest, so a few huge files cannot starve the budget).
  const candidates = scan.files.filter((f) => isScorable(f.path));
  const intent = classifyIntent(safeTask);
  const preRank = rankFiles({ candidates, terms, mentioned: mentionedPaths, intent, analyses: new Map() }).ranked;
  const sizeOf = new Map(candidates.map((f) => [f.path, f.size]));
  const readOrder = [
    ...preRank.filter((f) => f.score > 0),
    ...preRank.filter((f) => f.score <= 0).sort((a, b) => sizeOf.get(a.path) - sizeOf.get(b.path) || byCodeUnit(a.path, b.path)),
  ].map((f) => f.path);
  const { analyses, skipped: contentSkipped } = analyzeFiles(scan, reader, readOrder, { maxFiles: options.maxContentFiles ?? 5000, terms });

  // 2. Full scoring (every point carries a reason; see relevance.js for the scoring table).
  const { ranked: allRanked, termInfo } = rankFiles({ candidates, terms, mentioned: mentionedPaths, intent, analyses });
  const ranked = allRanked.filter((f) => f.score > 0).map((f) => ({ path: f.path, size: f.size, category: f.category, score: f.score, reasons: f.reasons }));
  const selectedFiles = ranked.slice(0, top).map((f) => {
    const a = analyses.get(f.path);
    const matchedSymbols = (a?.symbols ?? []).filter((s) => terms.some((t) => splitWords(s.name).some((tok) => matchTerm(t, tok))));
    const symbols = (matchedSymbols.length ? matchedSymbols : a?.symbols ?? []).slice(0, 6);
    return { ...f, sha256: a?.sha256 ?? null, symbols, related: findRelated(f.path, scan, analyses) };
  });

  // 3. Applicable instruction sections.
  const primary = selectedFiles.slice(0, 3).map((f) => f.path);
  const omissions = [];
  const docs = [];
  const seenHashes = new Map();
  for (const doc of scan.documents) {
    if (seenHashes.has(doc.sha256)) {
      omissions.push({ kind: 'instruction-duplicate', what: doc.path, reason: `identical content to ${seenHashes.get(doc.sha256)}` });
      continue;
    }
    seenHashes.set(doc.sha256, doc.path);
    const applies = doc.scope === '' || primary.some((p) => p.startsWith(`${doc.scope}/`));
    if (!applies) {
      omissions.push({ kind: 'instruction-scope', what: doc.path, reason: `applies only under ${doc.scope}/, which no selected file is in` });
      continue;
    }
    docs.push(doc);
  }
  const maxExcerptBytes = Math.max(400, Math.min(2400, Math.floor(budget.bytes / 4)));
  const sectionCandidates = [];
  for (const doc of docs) {
    const wholeDoc = doc.sections.length <= 1;
    for (const section of doc.sections) {
      if (section.title === '(preamble)' && !wholeDoc) continue;
      const body = sliceLines(doc.text, section.startLine, section.endLine);
      const lower = body.toLowerCase();
      const headingMatches = terms.filter((t) => splitWords(section.title).some((tok) => matchTerm(t, tok)));
      const bodyMatches = terms.filter((t) => !headingMatches.includes(t) && t.length >= 3 && lower.includes(t));
      const matched = headingMatches.length * 3 + bodyMatches.length;
      const baseline = BASELINE_HEADING.test(section.breadcrumb.join(' ')) || wholeDoc;
      if (matched === 0 && !baseline) continue;
      const why = matched > 0
        ? [headingMatches.length ? `heading matches ${headingMatches.map((t) => `"${t}"`).join(', ')}` : null, bodyMatches.length ? `body mentions ${bodyMatches.map((t) => `"${t}"`).join(', ')}` : null].filter(Boolean).join('; ')
        : 'general project guidance (commands, testing, conventions, structure)';
      const { text, cut } = truncateExcerpt(body, maxExcerptBytes);
      sectionCandidates.push({
        doc, section, matched, why, text, cut, bytes: byteLength(body),
        breadcrumb: section.breadcrumb.join(' > ') || '(preamble)',
      });
    }
  }
  for (const doc of docs) {
    const considered = sectionCandidates.filter((c) => c.doc === doc).length;
    const unrelated = doc.sections.length - considered;
    if (unrelated > 0) omissions.push({ kind: 'instruction-sections', what: doc.path, reason: `${unrelated} of ${doc.sections.length} section${doc.sections.length === 1 ? '' : 's'} not relevant to the task` });
  }
  sectionCandidates.sort((a, b) => b.matched - a.matched || byCodeUnit(a.doc.path, b.doc.path) || a.section.startLine - b.section.startLine);

  // 4. Facts for snapshot, commands and conventions.
  const facts = scan.facts;
  const pm = facts.find((f) => f.kind === 'package-manager')?.data.manager ?? null;
  const pmAmbiguous = facts.filter((f) => f.kind === 'package-manager').length > 1;
  const items = [];
  const add = (item) => items.push(item);

  const snapshotFacts = [];
  const stripDeclared = (f) => f.claim.replace(/ \((declared|lockfile present|declared in [^)]+)\)$/, '');
  const line = (label, list, describe = stripDeclared) => {
    if (!list.length) return;
    snapshotFacts.push(...list);
    return `- ${label}: ${list.map((f) => `${describe(f)} ${bracket(f)}`).join('; ')}`;
  };
  const snapshotLines = [
    line('Languages', facts.filter((f) => f.kind === 'language').slice(0, 4), (f) => `${f.data.language} (${f.data.files} file${f.data.files === 1 ? '' : 's'})`),
    line('Frameworks', facts.filter((f) => f.kind === 'framework')),
    line('Test frameworks', facts.filter((f) => f.kind === 'test-framework')),
    line('Package manager', facts.filter((f) => f.kind === 'package-manager'), (f) => `${f.data.manager}${f.data.declared ? ' (declared)' : ' (lockfile)'}`),
    line('Runtime and modules', facts.filter((f) => ['convention:module-system', 'convention:node-engines', 'convention:php-version'].includes(f.id))),
  ].filter(Boolean);
  if (snapshotLines.length) add({ id: 'snapshot', section: 'snapshot', priority: 10, markdown: snapshotLines.join('\n'), facts: snapshotFacts });

  // Core verification commands always; dev/start/format only when the task mentions them.
  const roleOrder = ['test', 'build', 'lint', 'typecheck', 'check', 'dev', 'start', 'format'];
  const coreRoles = new Set(['test', 'build', 'lint', 'typecheck', 'check']);
  const scriptFacts = facts
    .filter((f) => f.kind === 'script' && roleOrder.includes(f.data.role)
      && (coreRoles.has(f.data.role) || terms.some((t) => splitWords(f.data.name).some((tok) => matchTerm(t, tok)))))
    .sort((a, b) => roleOrder.indexOf(a.data.role) - roleOrder.indexOf(b.data.role) || byCodeUnit(a.id, b.id))
    .slice(0, 8);
  if (scriptFacts.length) {
    const rows = scriptFacts.map((f) => {
      const runner = f.data.runner === 'composer' ? `composer run ${f.data.name}` : packageRunner(pm, f.data.name);
      return `- ${f.data.role}: ${runner ? `\`${runner}\` -> ` : `script "${f.data.name}" -> `}\`${f.data.command}\` ${bracket(f)}`;
    });
    if (pmAmbiguous && !pm) rows.push('- note: several lockfiles exist, so the package manager is ambiguous; run commands are shown without one.');
    add({ id: 'commands', section: 'commands', priority: 36, markdown: rows.join('\n'), facts: scriptFacts });
  }

  selectedFiles.forEach((f, i) => {
    const lines = [`- \`${f.path}\` (score ${f.score}; ${fmtKiB(f.size)}${f.sha256 ? `; sha256 ${shortHash(f.sha256)}` : ''})`];
    lines.push(`  - why: ${[...f.reasons].filter((r) => r.points > 0).sort((a, b) => b.points - a.points).slice(0, 4).map((r) => r.brief ?? r.detail).join('; ')}`);
    if (f.symbols.length) lines.push(`  - symbols: ${f.symbols.map((s) => `${s.name} (${s.kind}, line ${s.line})`).join(', ')}`);
    if (f.related.length) lines.push(`  - related: ${f.related.slice(0, 3).map((r) => `\`${r.path}\` (${r.relation})`).join(', ')}`);
    add({
      id: `file:${f.path}`, section: 'files', priority: i < 3 ? 30 + i : 60 + i, markdown: lines.join('\n'), file: f,
      compact: `- \`${f.path}\` (score ${f.score}; reasons trimmed to fit budget)`,
    });
  });

  sectionCandidates.forEach((c, i) => {
    const head = `### ${c.doc.path} > ${c.breadcrumb} (lines ${c.section.startLine}-${c.section.endLine}, sha256 ${shortHash(c.doc.sha256)})`;
    const body = c.text.split('\n').map((l) => (l === '' ? '>' : `> ${l}`)).join('\n');
    const note = c.cut ? `\n> [truncated: ${c.cut} more line${c.cut === 1 ? '' : 's'} at ${c.doc.path}:${c.section.startLine}-${c.section.endLine}]` : '';
    add({
      id: `instruction:${c.doc.path}:${c.section.startLine}`, section: 'instructions',
      priority: c.matched > 0 ? 34 + i * 0.01 : 70 + i * 0.01,
      markdown: `${head}\nWhy included: ${c.why}\n${body}${note}`,
      instruction: { path: c.doc.path, section: c.breadcrumb, startLine: c.section.startLine, endLine: c.section.endLine, sha256: c.doc.sha256, why: c.why, truncated: c.cut > 0, text: c.text },
    });
  });

  const conventionFacts = facts.filter((f) => f.kind === 'convention' && !['convention:module-system', 'convention:node-engines', 'convention:php-version'].includes(f.id));
  conventionFacts.forEach((f, i) => {
    const relevant = terms.some((t) => splitWords(f.claim).some((tok) => matchTerm(t, tok)));
    add({ id: f.id, section: 'conventions', priority: relevant ? 35 + i * 0.01 : 55 + i * 0.01, markdown: `- ${f.claim} ${bracket(f)}`, facts: [f] });
  });

  // 5. Recommendations: inferred, never presented as facts.
  const recommendations = [];
  const roleScript = (role) => scriptFacts.find((f) => f.data.role === role);
  const topFile = selectedFiles[0];
  const pairedTest = topFile?.related.find((r) => r.relation.startsWith('test'));
  if (pairedTest) recommendations.push({ text: `Review and update \`${pairedTest.path}\` together with \`${topFile.path}\`.`, basedOn: [topFile.path, pairedTest.path] });
  for (const role of ['test', 'lint', 'typecheck']) {
    const s = roleScript(role);
    if (!s || !selectedFiles.length) continue;
    const runner = s.data.runner === 'composer' ? `composer run ${s.data.name}` : packageRunner(pm, s.data.name);
    recommendations.push({ text: `After changing the files above, run ${runner ? `\`${runner}\`` : `the "${s.data.name}" script`} (${role}).`, basedOn: [refOf(s)] });
  }
  if (!selectedFiles.length) {
    recommendations.push({ text: 'No file matched the task terms. Name a file, component, class or feature in the task, or pass explicit paths.', basedOn: [] });
  }
  if (!scan.documents.length) {
    recommendations.push({ text: 'No agent instruction file (AGENTS.md, CLAUDE.md, ...) was found. Run `contextanvil doctor` for details.', basedOn: [] });
  }
  if (recommendations.length) {
    add({
      id: 'recommendations', section: 'recommendations', priority: 45,
      markdown: recommendations.map((r) => `- ${r.text}${r.basedOn.length ? ` (based on: ${r.basedOn.join(', ')})` : ''}`).join('\n'),
      recommendations,
    });
  }

  // 6. Structural omissions (independent of budget).
  const ex = scan.stats.excluded;
  const structural = [];
  const excludedParts = [
    ex.ignored && `${ex.ignored} path${ex.ignored === 1 ? '' : 's'} matched ignore rules`,
    ex.defaultDirs && `${ex.defaultDirs} dependency/build/cache director${ex.defaultDirs === 1 ? 'y' : 'ies'}`,
    ex.sensitive && `${ex.sensitive} sensitive file${ex.sensitive === 1 ? '' : 's'} (contents never read)`,
    ex.binary && `${ex.binary} binary/media file${ex.binary === 1 ? '' : 's'}`,
    ex.symlinks && `${ex.symlinks} symlink${ex.symlinks === 1 ? '' : 's'} not followed`,
  ].filter(Boolean);
  if (excludedParts.length) structural.push({ kind: 'excluded', what: 'repository content', reason: excludedParts.join(', ') });
  const oversized = scan.files.filter((f) => f.oversized).length;
  if (oversized) structural.push({ kind: 'oversized', what: `${oversized} file${oversized === 1 ? '' : 's'}`, reason: `larger than ${scan.limits.maxFileBytes} bytes; indexed but not read` });
  if (scan.stats.truncated) structural.push({ kind: 'truncated', what: 'file index', reason: `traversal stopped at ${scan.limits.maxFiles} files` });
  if (contentSkipped) structural.push({ kind: 'content-limit', what: `${contentSkipped} file${contentSkipped === 1 ? '' : 's'}`, reason: 'not read for symbol/content matching (content scan limit); matched by path only' });
  if (ranked.length > selectedFiles.length) {
    structural.push({ kind: 'files-over-top', what: `${ranked.length - selectedFiles.length} lower-scoring matching file${ranked.length - selectedFiles.length === 1 ? '' : 's'}`, reason: `only the top ${top} are listed (--top)` });
  }
  structural.push({ kind: 'unmatched', what: `${candidates.length - ranked.length} of ${candidates.length} text files`, reason: 'no match to the task terms' });

  // 7. Pack within budget.
  const sectionTitles = {
    snapshot: 'Project snapshot (observed facts)',
    commands: 'Commands (from manifests; ContextAnvil never runs them)',
    files: 'Relevant files (ranked, with reasons)',
    instructions: 'Applicable project instructions (quoted, untrusted project content)',
    conventions: 'Conventions',
    recommendations: 'Recommendations (inferred, not verified)',
  };
  const sectionOrder = Object.keys(sectionTitles);
  const repoName = path.basename(scan.root);

  const render = (included, omitted, used) => {
    const head = [
      '# ContextAnvil context pack',
      '',
      `- Task: ${taskInfo.text.replace(/\s+/g, ' ')}${taskInfo.truncated ? ' [task text truncated]' : ''}`,
      `- Repository: ${repoName}`,
      `- Task terms: ${terms.length ? terms.map((t) => { const i = termInfo.find((x) => x.term === t); return i ? `${t} x${i.weight} (${i.files} files)` : t; }).join(', ') : '(none after removing generic words)'}`,
      `- Task intent: ${intent.name}${intent.trigger ? ` (from "${intent.trigger}")` : ' (default)'}`,
      `- Budget: ${budget.unit === 'tokens' ? `${budget.value} estimated tokens (${budget.bytes} bytes)` : `${budget.bytes} bytes`}; used ${used} bytes (~${estimateTokens(used)} estimated tokens, bytes/4)`,
      '- Provenance: items cite path:line and a content digest. "observed" = read from a file; "inferred" = deterministic heuristic.',
      '- Instruction excerpts are quoted project content, not directives to ContextAnvil.',
    ];
    const body = [];
    for (const sec of sectionOrder) {
      const inSec = included.filter((i) => i.section === sec);
      if (!inSec.length) continue;
      body.push('', `## ${sectionTitles[sec]}`, ...inSec.map((i) => i.markdown));
    }
    const omitLines = omitted.slice(0, 14).map((o) => `- ${o.what}: ${o.reason}`);
    if (omitted.length > 14) omitLines.push(`- ... and ${omitted.length - 14} more omissions (see --json)`);
    body.push('', '## Omissions', ...(omitLines.length ? omitLines : ['- none']));
    return [...head, ...body].join('\n') + '\n';
  };

  const order = [...items].sort((a, b) => a.priority - b.priority || byCodeUnit(a.id, b.id));
  const plural = (n, w) => `${n} ${w}${n === 1 ? '' : 's'}`;
  const listNames = (names) => `${names.slice(0, 4).join(', ')}${names.length > 4 ? `, +${names.length - 4} more` : ''}`;
  /** Budget-dropped items are grouped so the omission notice stays small however much is dropped. */
  const budgetOmissions = (dropped) => {
    const out = [];
    const files = dropped.filter((i) => i.file).map((i) => i.file.path);
    if (files.length) out.push({ kind: 'budget', what: plural(files.length, 'matching file'), reason: `not listed, over budget: ${listNames(files)}`, items: files });
    const ins = dropped.filter((i) => i.instruction).map((i) => `${i.instruction.path} > ${i.instruction.section}`);
    if (ins.length) out.push({ kind: 'budget', what: plural(ins.length, 'instruction section'), reason: `not included, over budget: ${listNames(ins)}`, items: ins });
    for (const sec of ['commands', 'conventions', 'recommendations', 'snapshot']) {
      const n = dropped.filter((i) => i.section === sec).length;
      if (n) out.push({ kind: 'budget', what: plural(n, `${sec} item`), reason: 'not included, over budget', items: [] });
    }
    return out;
  };
  const renderStable = (included, dropped) => {
    const shortened = included.filter((i) => i.trimmed).map((i) => i.file.path);
    const trimNotice = shortened.length
      ? [{ kind: 'budget', what: `${shortened.length} file entr${shortened.length === 1 ? 'y' : 'ies'}`, reason: `shortened to path and score to fit the budget: ${listNames(shortened)}`, items: shortened }]
      : [];
    const omitted = [...structural, ...omissions, ...trimNotice, ...budgetOmissions(dropped)];
    let used = 0;
    let text = '';
    for (let n = 0; n < 6; n++) {
      text = render(included, omitted, used);
      const size = byteLength(text);
      if (size === used) return { text, size, omitted };
      used = size;
    }
    return { text, size: byteLength(text), omitted };
  };

  let included = [];
  let dropped = [];
  // Reserve the envelope plus the worst-case omission notice, then fill greedily by priority.
  const reserve = renderStable([], order).size;
  let remaining = budget.bytes - reserve;
  const openSections = new Set();
  const blocked = new Set(); // ranked sections: once an item is dropped, lower-ranked ones may not jump the queue
  for (const item of order) {
    const headerCost = openSections.has(item.section) ? 0 : byteLength(`\n## ${sectionTitles[item.section]}\n`);
    let cost = byteLength(item.markdown) + 1 + headerCost;
    if (!blocked.has(item.section) && cost > remaining && item.compact) {
      const compactCost = byteLength(item.compact) + 1 + headerCost;
      if (compactCost <= remaining) {
        item.markdown = item.compact;
        item.trimmed = true;
        cost = compactCost;
      }
    }
    if (!blocked.has(item.section) && cost <= remaining) {
      included.push(item);
      openSections.add(item.section);
      remaining -= cost;
    } else {
      dropped.push(item);
      if (item.section === 'files' || item.section === 'instructions') blocked.add(item.section);
    }
  }
  let result = renderStable(included, dropped);
  while (result.size > budget.bytes && included.length) {
    const victim = included.reduce((worst, i) => (i.priority > worst.priority ? i : worst), included[0]);
    included = included.filter((i) => i !== victim);
    dropped.push(victim);
    result = renderStable(included, dropped);
  }
  if (result.size > budget.bytes) {
    throw new ContextAnvilError('BUDGET_TOO_SMALL', `Budget of ${budget.bytes} bytes is too small for even the pack envelope (${result.size} bytes). Increase --budget.`, { exitCode: 2 });
  }

  // 8. Structured form of exactly what was rendered.
  const includedFiles = included.filter((i) => i.file).map((i) => i.file);
  const includedFactIds = [...new Set(included.flatMap((i) => (i.facts ?? []).map((f) => f.id)))];
  return {
    schemaVersion: PACK_SCHEMA_VERSION,
    tool: { name: TOOL_NAME, version: VERSION },
    root: scan.root,
    task: { text: taskInfo.text, terms, termWeights: termInfo, intent, mentionedPaths, truncated: taskInfo.truncated },
    budget: {
      unit: budget.unit,
      limitBytes: budget.bytes,
      usedBytes: result.size,
      usedEstimatedTokens: estimateTokens(result.size),
      tokenEstimate: 'ceil(utf8 bytes / 4); a heuristic, not a tokenizer count',
    },
    facts: scan.facts.filter((f) => includedFactIds.includes(f.id)),
    files: includedFiles,
    instructions: included.filter((i) => i.instruction).map((i) => i.instruction),
    recommendations: recommendations.map((r) => ({ text: r.text, status: 'inferred', basedOn: r.basedOn })),
    omissions: result.omitted,
    rendered: result.text,
  };
}
