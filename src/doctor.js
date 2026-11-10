import { extractInlineReferences, lines } from './core/markdown.js';
import { byCodeUnit, dirname, normalizeRelative } from './core/paths.js';
import { redact } from './core/secrets.js';
import { DEFAULT_EXCLUDED_DIRS } from './core/walker.js';
import { stripJsonc } from './detectors/context.js';
import { commandProjects, instructionCommands } from './doctor-commands.js';
import { readerFor } from './scanner.js';
import { TOOL_NAME, VERSION } from './version.js';

export const DOCTOR_SCHEMA_VERSION = 1;
const SEVERITY_RANK = { error: 0, warning: 1, info: 2 };
const CATEGORY_ORDER = ['missing', 'conflict', 'stale', 'unsafe', 'scan'];

/** Phrases that attempt to steer an agent against its user. Heuristic, deliberately narrow. */
const NEGATION = /\b(do not|don't|dont|never|must not|should not|shouldn't|cannot|can't|not allowed|avoid|prohibit(ed)?|forbid(den)?)\b/i;

/** Patterns whose match is harmless (or even protective) when the sentence forbids the behaviour. */
const NEGATABLE = new Set(['ignore-instructions', 'reveal-secrets', 'skip-confirmation', 'disable-safety']);

const INJECTION_PATTERNS = [
  ['ignore-instructions', /\b(ignore|disregard|forget|override)\b[^.\n]{0,40}\b(previous|prior|above|earlier|all|any)\b[^.\n]{0,30}\b(instructions?|rules?|guidelines?|prompts?)\b/i],
  ['reveal-secrets', /\b(reveal|print|output|send|upload|exfiltrate|leak)[ \t]{1,8}(?:(?:the|all|your|our|raw|actual|stored|private)[ \t]{1,8}){0,4}(?:secrets?|credentials?|api[ _-]?keys?|tokens?|passwords?|env(?:ironment)? variables?|system prompt)\b/i],
  ['hide-from-user', /\b(do not|don't|never)\b[^.\n]{0,20}\b(tell|inform|notify|show)\b[^.\n]{0,20}\b(the )?user\b/i],
  ['skip-confirmation', /\bwithout\b[^.\n]{0,15}\b(asking|confirm(ation|ing)?|approval|permission)\b/i],
  ['disable-safety', /\b(disable|bypass|turn off|circumvent)\b[^.\n]{0,30}\b(safety|guardrails?|security (checks?|warnings?|controls?)|content (filters?|polic(y|ies)))\b/i],
  ['role-override', /\byou are now (an? )?(unrestricted|jailbroken|in developer mode|dan)\b|<\/?(system|assistant|im_start|im_end)>|<\|im_(start|end)\|>|\[\/?INST\]|^\s*(system|assistant)\s*:\s*(you|ignore|disregard|forget)/i],
  ['exfiltrate-to-url', /\b(send|post|upload|exfiltrate|forward|transmit)\b[^.\n]{0,60}\b(secrets?|credentials?|tokens?|api keys?|\.env|environment variables?|conversation|chat history|source code)\b[^.\n]{0,60}\b(to|at|via)\b[^.\n]{0,40}https?:\/\//i],
  ['pipe-to-shell', /\b(curl|wget)\b[^\n|]*\|\s*(sudo\s+)?(ba|z)?sh\b/i],
  ['encoded-execution', /\bbase64\b[^\n|]*(-d|--decode)[^\n|]*\|\s*(ba|z)?sh\b/i],
];

const PLACEHOLDER_PATH = /(^|\/)(path|your|my|foo|bar|example|some|dir|folder)(\/|$)|\.\.\.|<|>/i;
const GUIDE_IMPORT = /^\s*@([\w.@/-]{1,512}\.md)\s*$/i;
const GUIDE_LINK = /^\[([^\]\r\n]{1,80})\]\(([\w.@/-]{1,400}\.md)\)$/i;
const PATH_EXAMPLE = /\b(?:for example|sample (?:link|path)|placeholder|e\.g\.)\b/i;
const EXTERNAL_SCOPE = /\b(?:another|external|upstream|separate|other) (?:git |github )?(?:repository|repo)\b/i;
const GENERATED = /\b(?:generated|build output|artifacts?|written to|gitignored|not tracked|where binaries are built)\b/i;
const SOURCE_LOCATION = /\b(?:source|implemented|implementation|hardcoded|checked[- ]in|tracked)\b/i;

function finding(severity, category, id, title, detail, evidence = [], recommendation) {
  return { id, severity, category, title, detail, evidence, ...(recommendation ? { recommendation } : {}) };
}

function pathCandidates(doc, value, via) {
  const parent = dirname(doc.path);
  const relative = normalizeRelative(parent ? `${parent}/${value}` : value);
  return [...new Set([relative, ...(via === 'code' ? [normalizeRelative(value)] : [])].filter(Boolean))];
}

function agentConfig(text) {
  let config;
  try {
    config = JSON.parse(stripJsonc(text));
  } catch {
    return null;
  }
  const hooks = config?.hooks && typeof config.hooks === 'object';
  const servers = config?.mcpServers ?? config?.servers;
  if (!hooks && (!servers || typeof servers !== 'object')) return null;
  const entries = Object.values(servers ?? {});
  return {
    hooks,
    local: entries.some((server) => typeof server?.command === 'string'),
    remote: entries.some((server) => typeof server?.url === 'string'),
  };
}

function lifecycleDetail({ runner, name }) {
  if (runner !== 'composer') return `Node package managers may invoke ${name} during installation or preparation, depending on the command and flags.`;
  if (name === 'post-autoload-dump') return 'Composer may invoke this hook after regenerating the autoloader.';
  const timing = name.startsWith('pre-') ? 'before' : 'after';
  const event = name.includes('-update-') ? 'updating dependencies' : 'installing locked dependencies';
  return `Composer may invoke this hook ${timing} ${event}.`;
}

/**
 * Diagnose the context configuration of a scanned repository.
 * Pure function of the scan; reads files only through the scan's safe reader.
 */
export function diagnose(scan, { excerpts = false } = {}) {
  const reader = readerFor(scan);
  const findings = [];
  const docs = scan.documents;
  const facts = scan.facts;
  const scripts = facts.filter((f) => f.kind === 'script' && !f.data.runner);
  const hasNodeManifest = facts.some((f) => f.id === 'manifest:package.json' && f.confidence !== 'low');
  const docScopes = new Map(docs.map((d) => [d.path, d.scope]));
  const independent = (doc) => !doc.symlinkTo || docScopes.get(doc.symlinkTo) !== doc.scope;
  const projects = commandProjects(scan, reader);
  const commands = docs.filter(independent).flatMap((d) => instructionCommands(d, projects));

  // ---- missing -------------------------------------------------------------
  if (!docs.length) {
    findings.push(finding('warning', 'missing', 'no-agent-instructions', 'No agent instruction files found',
      'No AGENTS.md, CLAUDE.md, GEMINI.md, Copilot or Cursor instruction file exists. Coding agents will have to rediscover build, test and style conventions every session.',
      [], 'Add an AGENTS.md describing build/test commands and conventions. `contextanvil scan` shows the facts it could start from.'));
  } else {
    const has = (re) => docs.some((d) => re.test(d.path));
    if (has(/(^|\/)AGENTS\.md$/i) && !has(/(^|\/)CLAUDE\.md$/i)) {
      findings.push(finding('info', 'missing', 'agents-without-claude', 'AGENTS.md exists but CLAUDE.md does not',
        'Tools that read CLAUDE.md will not see your AGENTS.md unless CLAUDE.md points to it.',
        [{ path: docs.find((d) => /AGENTS\.md$/i.test(d.path)).path }],
        'Consider a CLAUDE.md that references AGENTS.md instead of duplicating it.'));
    }
    if (has(/(^|\/)CLAUDE\.md$/i) && !has(/(^|\/)AGENTS\.md$/i)) {
      findings.push(finding('info', 'missing', 'claude-without-agents', 'CLAUDE.md exists but AGENTS.md does not',
        'Agents that read AGENTS.md (for example OpenAI Codex) will not see these instructions.',
        [{ path: docs.find((d) => /CLAUDE\.md$/i.test(d.path)).path }],
        'Consider an AGENTS.md as the shared source and have CLAUDE.md reference it.'));
    }
  }
  for (const d of docs) {
    const nonHeading = d.text.split('\n').filter((l) => l.trim() && !l.trimStart().startsWith('#')).join('\n').trim();
    const imported = nonHeading.length <= 512 && (GUIDE_IMPORT.test(nonHeading) || GUIDE_LINK.test(nonHeading));
    if (nonHeading.length < 80 && !imported && (!d.scope || !nonHeading)) {
      findings.push(finding('warning', 'missing', 'instruction-empty', `${d.path} has almost no content`,
        'The file contains less than 80 characters outside headings.', [{ path: d.path }], 'Describe build, test and style conventions, or remove the file.'));
    }
    if (d.estimatedTokens > 8000) {
      findings.push(finding('warning', 'missing', 'instruction-oversized', `${d.path} is very large (~${d.estimatedTokens} estimated tokens)`,
        'Large instruction files consume context in every session that loads them and dilute the important rules.', [{ path: d.path }], 'Split it by directory scope or trim to the rules that change behaviour.'));
    } else if (d.estimatedTokens > 4000) {
      findings.push(finding('info', 'missing', 'instruction-large', `${d.path} is large (~${d.estimatedTokens} estimated tokens)`,
        'Consider whether every section is needed in every session.', [{ path: d.path }]));
    }
  }
  const rootDocs = docs.filter((d) => d.scope === '');
  if (docs.length && hasNodeManifest) {
    for (const role of ['test', 'build']) {
      const script = scripts.find((f) => f.data.name === role);
      if (!script) continue;
      const mentioned = commands.some((command) => command.scope === '' && command.name === role)
        || rootDocs.some((d) => d.text.toLowerCase().includes(script.data.command.toLowerCase()));
      if (!mentioned && rootDocs.length) {
        findings.push(finding('info', 'missing', `instructions-omit-${role}`, `Instructions do not mention the ${role} command`,
          `package.json defines a "${script.data.name}" script, but no root instruction file refers to it.`,
          [{ path: script.evidence[0].path, line: script.evidence[0].line }], `Document how to ${role} the project.`));
      }
    }
  }

  // ---- conflict ------------------------------------------------------------
  const managerByProject = new Map();
  for (const command of commands) {
    const project = projects.load(command.scope);
    if (command.alternative || !project || (!command.install && project.scripts.has(command.name))) continue;
    if (!managerByProject.has(project)) managerByProject.set(project, new Map());
    const managers = managerByProject.get(project);
    if (!managers.has(command.manager)) managers.set(command.manager, command);
  }
  for (const [project, managers] of managerByProject) {
    const names = [...managers.keys()].sort(byCodeUnit);
    if (names.length > 1 && [...managers.values()].some((command) => command.install)) {
      const evidence = [...managers.values()].map(({ path, line, manager }) => ({ path, line, note: manager }));
      findings.push(finding('warning', 'conflict', 'conflicting-package-managers', 'Instructions give conflicting package-manager guidance',
        `Commands for ${names.join(', ')} apply to ${project.path}.`, evidence, 'Clarify which package manager owns this project.'));
    } else if (project.manager) {
      const command = [...managers.values()].find((c) => c.install && c.manager !== project.manager);
      if (!command) continue;
      findings.push(finding('warning', 'conflict', 'instruction-lockfile-mismatch',
        `Instructions install with ${command.manager} but the project uses ${project.manager}`,
        `The lockfile/packageManager field for ${project.path} indicates ${project.manager}.`,
        [{ path: command.path, line: command.line }, ...project.managerEvidence],
        `Verify the install workflow and document the command for ${project.manager}.`));
    }
  }
  for (const diag of scan.diagnostics) {
    if (diag.code === 'multiple-lockfiles') {
      findings.push(finding('warning', 'conflict', 'multiple-lockfiles', 'Lockfiles from several package managers', diag.message, [{ path: diag.path }], 'Keep one lockfile and delete the others.'));
    } else if (diag.code === 'package-manager-mismatch') {
      findings.push(finding('warning', 'conflict', 'package-manager-mismatch', 'packageManager field disagrees with the lockfile', diag.message, [{ path: diag.path }]));
    }
  }
  const byHash = new Map();
  for (const d of docs) {
    if (d.symlinkTo) continue;
    byHash.set(d.sha256, [...(byHash.get(d.sha256) ?? []), d]);
  }
  for (const group of byHash.values()) {
    if (group.length > 1) {
      findings.push(finding('info', 'conflict', 'duplicate-instructions', 'Identical instruction files', `${group.map((g) => g.path).join(' and ')} have identical content and can drift apart.`,
        group.map((g) => ({ path: g.path })), 'Keep one file and have the other reference it (or use a symlink).'));
    }
  }

  // ---- stale ---------------------------------------------------------------
  const reportedScripts = new Set();
  for (const ref of commands) {
    if (!ref.name || ref.alternative) continue;
    const project = projects.load(ref.scope);
    if (!project || project.scripts.has(ref.name)) continue;
    const key = JSON.stringify([ref.path, project.path, ref.name]);
    if (reportedScripts.has(key)) continue;
    reportedScripts.add(key);
    findings.push(finding('warning', 'stale', 'missing-script-reference', `${ref.path} references script "${ref.name}" that ${project.path} does not define`,
      `"${ref.text}" was checked against ${project.path} using the documented scope. Heuristic: medium confidence.`,
      [{ path: ref.path, line: ref.line }, { path: project.path }], 'Verify the working directory and update the script reference.'));
  }
  for (const d of docs) {
    if (!independent(d)) continue;
    const reported = new Set();
    const docLines = [...lines(d.text)];
    const imports = docLines.filter((line) => !line.inFence && line.text.length <= 512)
      .flatMap((line) => {
        const match = GUIDE_IMPORT.exec(line.text);
        return match ? [{ value: match[1], line: line.number, via: 'import' }] : [];
      });
    for (const ref of [...imports, ...extractInlineReferences(d.text)].sort((a, b) => a.line - b.line)) {
      const value = ref.value.replace(/[#?].*$/, '').replace(/[.,;:]+$/, '');
      if (!value || /^[a-z][a-z0-9+.-]*:/i.test(value) || value.startsWith('//') || value.startsWith('~') || value.startsWith('/')) continue;
      if (/[*{}$|=\s]/.test(value) || PLACEHOLDER_PATH.test(value)) continue;
      if ((ref.via === 'code' && !value.includes('/')) || !(/\.[A-Za-z0-9]{1,6}$/.test(value) || value.endsWith('/'))) continue;
      if (!/^[\w@.\-/]+$/.test(value)) continue;
      const context = docLines.slice(Math.max(0, ref.line - 2), ref.line + 1)
        .filter((line) => !line.inFence && line.text.length <= 4000).map((line) => line.text.trim()).join(' ');
      const sourceLine = docLines[ref.line - 1].text;
      if (PATH_EXAMPLE.test(sourceLine) || EXTERNAL_SCOPE.test(sourceLine)
        || (/(?:\bvendored\b|\bdependency\b)/i.test(context) && /^(?:lib|vendor)\//.test(value))
        || GENERATED.test(sourceLine)) continue;
      const candidates = pathCandidates(d, value, ref.via);
      if (!candidates.length || candidates.some((p) => reader.exists(p))) continue;
      const target = normalizeRelative(value) ?? candidates[0];
      const first = target.split('/')[0];
      if ((DEFAULT_EXCLUDED_DIRS.has(first) && !(first === 'build' && SOURCE_LOCATION.test(context) && candidates.some((p) => reader.exists(dirname(p)))))
        || (target.startsWith('target/') && reader.has('Cargo.toml')) || target.startsWith('storage/') || target.startsWith('bootstrap/cache')) continue;
      // A partial path such as "features/" is usually relative to some other directory (src/, app/, ...).
      if (ref.via === 'code' && scan.files.some((f) => f.path.startsWith(`${target}/`) || f.path.includes(`/${target}/`) || f.path.endsWith(`/${target}`))) continue;
      if (reported.has(target)) continue;
      reported.add(target);
      findings.push(finding('warning', 'stale', 'missing-path-reference', `${d.path} references ${target}, which does not exist`,
        `No matching path was found from the instruction directory${ref.via === 'code' ? ' or repository root' : ''}. Heuristic: medium confidence.`,
        [{ path: d.path, line: ref.line }], 'Verify the intended scope, then correct or qualify the reference.'));
      if (reported.size >= 15) break;
    }
  }
  for (const diag of scan.diagnostics) {
    if (diag.code === 'entrypoint-missing') {
      findings.push(finding('warning', 'stale', 'entrypoint-missing', 'Manifest points to a file that does not exist', diag.message, [{ path: diag.path, line: diag.line }]));
    }
  }

  // ---- unsafe --------------------------------------------------------------
  for (const d of docs) {
    for (const s of d.secretFindings) {
      findings.push(finding('error', 'unsafe', 'secret-in-instructions', `Probable ${s.type} in ${d.path}`,
        'Instruction files are read by agents and often committed. The value is not shown here.', [{ path: d.path, line: s.line }], 'Remove the secret, rotate it, and reference an environment variable by name instead.'));
    }
    const controls = d.hiddenCharacters.filter((h) => h.control);
    const invisible = d.hiddenCharacters.filter((h) => !h.control);
    if (controls.length) {
      findings.push(finding('warning', 'unsafe', 'terminal-control-characters', `${d.path} contains terminal control characters`,
        `${controls.length} control character(s) such as ${[...new Set(controls.map((h) => h.codepoint))].slice(0, 3).join(', ')} (for example ESC) can rewrite what a terminal displays. ContextAnvil shows them as <U+XXXX>.`,
        [...new Set(controls.map((h) => h.line))].slice(0, 5).map((line) => ({ path: d.path, line })), 'Delete the characters.'));
    }
    if (invisible.length) {
      const lines_ = [...new Set(invisible.map((h) => h.line))];
      findings.push(finding('warning', 'unsafe', 'hidden-characters', `${d.path} contains invisible or direction-changing characters`,
        `${invisible.length} character(s) such as ${[...new Set(invisible.map((h) => h.codepoint))].slice(0, 3).join(', ')} can hide text from human reviewers. They are shown as <U+XXXX> in ContextAnvil output.`,
        lines_.slice(0, 5).map((line) => ({ path: d.path, line })), 'Delete the characters unless they are intentional.'));
    }
    const textLines = d.text.split('\n');
    const hit = new Set();
    for (const [pid, re] of INJECTION_PATTERNS) {
      textLines.forEach((l, i) => {
        const m = re.exec(l);
        // "never X" / "do not X without Y": a negator in the same clause (not an earlier one) forbids the behaviour.
        if (m && NEGATABLE.has(pid) && NEGATION.test(l.slice(0, m.index).split(/[,;:]|\b(?:and|then|but)\b/i).pop())) return;
        if (m && !hit.has(`${pid}:${i}`)) {
          hit.add(`${pid}:${i}`);
          findings.push(finding('warning', 'unsafe', `suspicious-instruction:${pid}`, `${d.path} contains text that tries to steer an agent (${pid})`,
            `Line ${i + 1}: "${redact(l.trim()).slice(0, 100)}". ContextAnvil treats this as data and never follows it. Review whether you intend agents to follow it.`,
            [{ path: d.path, line: i + 1 }], 'Remove or rewrite the line if it was not written deliberately.'));
        }
      });
    }
    for (const l of lines(d.text)) {
      if (l.text.length > 4000) continue; // pathological line: not worth a regex pass
      const refComment = /^\s*\[\/\/\]:\s*#\s*[("'](.{40,})/.exec(l.text);
      if (refComment && refComment[1].trim().split(/\s+/).length >= 6) {
        findings.push(finding('info', 'unsafe', 'hidden-comment', `${d.path} has a hidden Markdown comment with instruction-like text`,
          'Link-reference comments are invisible in rendered Markdown but still read by agents.', [{ path: d.path, line: l.number }], 'Move it into visible text or delete it.'));
      }
      if (/<[a-z][^>]{0,200}(style\s*=\s*["'][^"']*(display\s*:\s*none|visibility\s*:\s*hidden|font-size\s*:\s*0)|\shidden[\s>])/i.test(l.text)) {
        findings.push(finding('warning', 'unsafe', 'hidden-html-element', `${d.path} contains an HTML element that is hidden when rendered`,
          'Hidden elements are invisible to human reviewers but still read by agents.', [{ path: d.path, line: l.number }], 'Make the text visible or remove it.'));
      }
      if (/(?<![A-Za-z0-9+/=])[A-Za-z0-9+/]{300}/.test(l.text)) {
        findings.push(finding('info', 'unsafe', 'encoded-payload', `${d.path} contains a long encoded-looking string`,
          'A 300+ character base64-like run can carry hidden instructions or a payload. Review it.', [{ path: d.path, line: l.number }]));
      }
      const c = /<!--([\s\S]*?)-->/.exec(l.text);
      if (c && c[1].trim().split(/\s+/).length >= 6) {
        findings.push(finding('info', 'unsafe', 'hidden-comment', `${d.path} has an HTML comment with instruction-like text`,
          'HTML comments are invisible in rendered Markdown but still read by agents.', [{ path: d.path, line: l.number }], 'Move it into visible text or delete it.'));
      }
    }
  }
  for (const s of scan.sensitiveFiles) {
    findings.push(finding('info', 'unsafe', 'sensitive-file-not-ignored', `${s.path} (${s.reason}) is not covered by ignore rules`,
      'The filename suggests this file may contain sensitive data. ContextAnvil did not read it or check whether Git tracks it.',
      [{ path: s.path }], 'Verify the intended role and tracking status before deciding whether to ignore or secure the file.'));
  }
  if (!scan.files.some((f) => f.path === '.gitignore')) {
    findings.push(finding('info', 'unsafe', 'no-gitignore', 'No .gitignore at the repository root', 'Without ignore rules, build output and local files may end up in agent context.', [], 'Add a .gitignore.'));
  }
  for (const f of facts.filter((x) => x.kind === 'script' && x.data.runsOnInstall)) {
    findings.push(finding('info', 'unsafe', 'install-time-script', `Lifecycle script "${f.data.name}" can run automatically`,
      lifecycleDetail(f.data), [{ path: f.evidence[0].path, line: f.evidence[0].line }],
      'Review this script and the package-manager command before installing dependencies.'));
  }
  for (const f of facts.filter((x) => x.kind === 'config' && x.data.category === 'agent')) {
    const config = agentConfig(reader.read(f.source) ?? '');
    if (!config) continue;
    const behavior = [
      config.hooks && 'It declares an agent hook section.',
      config.local && 'It declares local MCP commands.',
      config.remote && 'It declares remote MCP endpoints.',
    ].filter(Boolean).join(' ');
    findings.push(finding('info', 'unsafe', 'agent-executable-config', `${f.source} declares agent integration settings`,
      behavior || 'No local command or remote endpoint was identified in the settings.',
      [{ path: f.source }], 'Review the settings before enabling the integration.'));
  }

  // ---- scan quality ----------------------------------------------------------
  for (const diag of scan.diagnostics) {
    if (['malformed-json', 'instruction-unreadable', 'file-limit', 'depth-limit', 'symlink-escape', 'unreadable-directory', 'file-too-large', 'detector-failed',
      'credential-filename', 'unsafe-symlink-target'].includes(diag.code)) {
      const testFixture = diag.code === 'malformed-json' && diag.path?.split('/').slice(0, -1).includes('fixtures')
        && diag.path.split('/').some((part) => ['test', 'tests', '__tests__'].includes(part));
      const severity = diag.level === 'error' ? 'error' : testFixture ? 'info' : 'warning';
      findings.push(finding(severity, 'scan', diag.code, diag.message,
        testFixture ? 'This file is in a test fixture directory and may be intentionally invalid.' : 'This limits how complete the analysis is.',
        diag.path ? [{ path: diag.path, line: diag.line }] : []));
    }
  }

  const unique = new Map();
  for (const f of findings) {
    const key = `${f.id}|${f.title}|${f.evidence.map((e) => `${e.path}:${e.line ?? ''}`).join(',')}`;
    if (!unique.has(key)) unique.set(key, f);
  }
  const sorted = [...unique.values()].sort((a, b) =>
    SEVERITY_RANK[a.severity] - SEVERITY_RANK[b.severity]
    || CATEGORY_ORDER.indexOf(a.category) - CATEGORY_ORDER.indexOf(b.category)
    || byCodeUnit(a.id, b.id)
    || byCodeUnit(a.title, b.title)
    || byCodeUnit(a.evidence[0]?.path ?? '', b.evidence[0]?.path ?? '')
    || (a.evidence[0]?.line ?? 0) - (b.evidence[0]?.line ?? 0));

  const summary = { error: 0, warning: 0, info: 0 };
  for (const f of sorted) summary[f.severity]++;
  if (excerpts) {
    const documents = new Map(docs.map((doc) => [doc.path, { lines: doc.text.split(/\r?\n/), secrets: new Set(doc.secretFindings.map((s) => s.line)) }]));
    for (const f of sorted) {
      if (f.category !== 'stale' && f.category !== 'conflict') continue;
      for (const evidence of f.evidence.slice(0, 4)) {
        const doc = documents.get(evidence.path);
        const line = doc?.lines[evidence.line - 1]?.trim();
        if (!line || doc.secrets.has(evidence.line) || line.includes('[REDACTED:')) continue;
        evidence.excerpt = line.length > 120 ? `${line.slice(0, 117)}...` : line;
      }
    }
  }
  return { schemaVersion: DOCTOR_SCHEMA_VERSION, tool: { name: TOOL_NAME, version: VERSION }, root: scan.root, summary, findings: sorted };
}

/** Exit status for `doctor`: true when findings reach the chosen threshold. */
export function exceedsThreshold(report, failOn) {
  if (failOn === 'never') return false;
  if (failOn === 'error') return report.summary.error > 0;
  return report.summary.error + report.summary.warning > 0;
}
