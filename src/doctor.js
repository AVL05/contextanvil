import { extractInlineReferences, lines } from './core/markdown.js';
import { byCodeUnit, dirname, normalizeRelative } from './core/paths.js';
import { redact } from './core/secrets.js';
import { DEFAULT_EXCLUDED_DIRS } from './core/walker.js';
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
  ['reveal-secrets', /\b(reveal|print|output|send|upload|exfiltrate|leak)\b[^.\n]{0,50}\b(secrets?|credentials?|api[ _-]?keys?|tokens?|passwords?|env(ironment)? variables?|system prompt)\b/i],
  ['hide-from-user', /\b(do not|don't|never)\b[^.\n]{0,20}\b(tell|inform|notify|show)\b[^.\n]{0,20}\b(the )?user\b/i],
  ['skip-confirmation', /\bwithout\b[^.\n]{0,15}\b(asking|confirm(ation|ing)?|approval|permission)\b/i],
  ['disable-safety', /\b(disable|bypass|turn off|circumvent)\b[^.\n]{0,30}\b(safety|guardrails?|security (checks?|warnings?|controls?)|content (filters?|polic(y|ies)))\b/i],
  ['role-override', /\byou are now (an? )?(unrestricted|jailbroken|in developer mode|dan)\b|<\/?(system|assistant|im_start|im_end)>|<\|im_(start|end)\|>|\[\/?INST\]|^\s*(system|assistant)\s*:\s*(you|ignore|disregard|forget)/i],
  ['exfiltrate-to-url', /\b(send|post|upload|exfiltrate|forward|transmit)\b[^.\n]{0,60}\b(secrets?|credentials?|tokens?|api keys?|\.env|environment variables?|conversation|chat history|source code)\b[^.\n]{0,60}\b(to|at|via)\b[^.\n]{0,40}https?:\/\//i],
  ['pipe-to-shell', /\b(curl|wget)\b[^\n|]*\|\s*(sudo\s+)?(ba|z)?sh\b/i],
  ['encoded-execution', /\bbase64\b[^\n|]*(-d|--decode)[^\n|]*\|\s*(ba|z)?sh\b/i],
];

const MANAGER_BUILTINS = new Set([
  'install', 'i', 'ci', 'add', 'remove', 'rm', 'uninstall', 'update', 'upgrade', 'up', 'init', 'publish', 'pack', 'audit',
  'outdated', 'link', 'unlink', 'exec', 'x', 'dlx', 'create', 'config', 'cache', 'login', 'logout', 'whoami', 'view', 'info',
  'ls', 'list', 'prune', 'dedupe', 'rebuild', 'root', 'bin', 'prefix', 'doctor', 'help', 'why', 'version', 'workspace',
  'workspaces', 'patch', 'import', 'store', 'set', 'get', 'pm', 'run', 'run-script',
]);
const PLACEHOLDER_PATH = /(^|\/)(path|your|my|foo|bar|example|some|dir|folder)(\/|$)|\.\.\.|<|>/i;

function finding(severity, category, id, title, detail, evidence = [], recommendation) {
  return { id, severity, category, title, detail, evidence, ...(recommendation ? { recommendation } : {}) };
}

/** Text that is clearly a command: fenced code lines and inline code spans (never prose). */
function* codeSegments(text) {
  for (const l of lines(text)) {
    if (l.inFence) {
      if (!/^ {0,3}(```|~~~)/.test(l.text)) yield { text: l.text, line: l.number };
    } else {
      for (const m of l.text.matchAll(/`([^`\n]+)`/g)) yield { text: m[1], line: l.number };
    }
  }
}

function managersIn(text) {
  const found = new Map();
  for (const seg of codeSegments(text)) {
    for (const m of seg.text.matchAll(/\b(npm|yarn|pnpm|bun)\s+(install|ci|i|add|run|test|start|build|dev|exec|x|dlx|lint)\b/g)) {
      if (!found.has(m[1])) found.set(m[1], seg.line);
    }
  }
  return found;
}

function scriptReferences(text) {
  const refs = [];
  for (const l of codeSegments(text)) {
    for (const m of l.text.matchAll(/\b(npm|yarn|pnpm|bun)\s+(?:(?:run|run-script)\s+)?([A-Za-z][\w:.-]*)/g)) {
      const explicitRun = /\b(?:run|run-script)\s/.test(m[0]);
      const name = m[2];
      if (!explicitRun && MANAGER_BUILTINS.has(name)) continue;
      if (explicitRun && name === 'run') continue;
      refs.push({ manager: m[1], name, line: l.line, text: m[0].replace(/\s+/g, ' ') });
    }
  }
  return refs;
}

/**
 * Diagnose the context configuration of a scanned repository.
 * Pure function of the scan; reads files only through the scan's safe reader.
 */
export function diagnose(scan) {
  const reader = readerFor(scan);
  const findings = [];
  const docs = scan.documents;
  const facts = scan.facts;
  const scripts = facts.filter((f) => f.kind === 'script' && !f.data.runner);
  const scriptNames = new Set(scripts.map((f) => f.data.name));
  const hasNodeManifest = facts.some((f) => f.id === 'manifest:package.json' && f.confidence !== 'low');
  const lockManagers = facts.filter((f) => f.kind === 'package-manager').map((f) => f.data.manager);

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
    const nonHeading = d.text.split('\n').filter((l) => l.trim() && !/^\s*#/.test(l)).join('\n');
    if (nonHeading.length < 80) {
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
      const script = scripts.find((f) => f.data.role === role);
      if (!script) continue;
      const mentioned = rootDocs.some((d) => scriptReferences(d.text).some((r) => r.name === script.data.name) || d.text.toLowerCase().includes(script.data.command.toLowerCase()));
      if (!mentioned && rootDocs.length) {
        findings.push(finding('info', 'missing', `instructions-omit-${role}`, `Instructions do not mention the ${role} command`,
          `package.json defines a "${script.data.name}" script, but no root instruction file refers to it.`,
          [{ path: script.evidence[0].path, line: script.evidence[0].line }], `Document how to ${role} the project.`));
      }
    }
  }

  // ---- conflict ------------------------------------------------------------
  const managerByDoc = new Map();
  for (const d of docs) {
    if (d.symlinkTo) continue;
    const m = managersIn(d.text);
    if (m.size) managerByDoc.set(d, m);
  }
  const mentionedManagers = new Set([...managerByDoc.values()].flatMap((m) => [...m.keys()]));
  if (mentionedManagers.size > 1) {
    const evidence = [];
    for (const [d, m] of managerByDoc) for (const [mgr, line] of m) evidence.push({ path: d.path, line, note: mgr });
    findings.push(finding('warning', 'conflict', 'conflicting-package-managers', 'Instructions mention different package managers',
      `Commands for ${[...mentionedManagers].sort(byCodeUnit).join(', ')} appear in the instruction files. Agents may run the wrong one.`,
      evidence, 'Standardise on one package manager across all instruction files.'));
  } else if (mentionedManagers.size === 1 && lockManagers.length === 1 && !lockManagers.includes([...mentionedManagers][0])) {
    const mgr = [...mentionedManagers][0];
    const [d, m] = [...managerByDoc.entries()][0];
    findings.push(finding('warning', 'conflict', 'instruction-lockfile-mismatch', `Instructions use ${mgr} but the project uses ${lockManagers[0]}`,
      `The lockfile/packageManager field indicates ${lockManagers[0]}.`, [{ path: d.path, line: m.get(mgr) }, { path: scan.facts.find((f) => f.kind === 'package-manager').source }],
      `Update the instructions to use ${lockManagers[0]}, or migrate the project.`));
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
  if (hasNodeManifest) {
    for (const d of rootDocs) {
      const reported = new Set();
      for (const ref of scriptReferences(d.text)) {
        const key = `${d.path}:${ref.name}`;
        if (reported.has(key) || scriptNames.has(ref.name)) continue;
        reported.add(key);
        findings.push(finding('warning', 'stale', 'missing-script-reference', `${d.path} references script "${ref.name}" that package.json does not define`,
          `"${ref.text}" appears in the instructions but package.json has no such script. Heuristic: medium confidence.`,
          [{ path: d.path, line: ref.line }], 'Update the instruction or add the script.'));
      }
    }
  }
  for (const d of docs) {
    const reported = new Set();
    for (const ref of extractInlineReferences(d.text)) {
      const value = ref.value.replace(/[#?].*$/, '').replace(/[.,;:]+$/, '');
      if (!value || /^[a-z][a-z0-9+.-]*:/i.test(value) || value.startsWith('//') || value.startsWith('~') || value.startsWith('/')) continue;
      if (/[*{}$|=\s]/.test(value) || PLACEHOLDER_PATH.test(value)) continue;
      if (!value.includes('/') || !(/\.[A-Za-z0-9]{1,6}$/.test(value) || value.endsWith('/'))) continue;
      if (!/^[\w@.\-/]+$/.test(value)) continue;
      const fromRoot = normalizeRelative(value);
      const fromDoc = normalizeRelative(`${dirname(d.path) ? `${dirname(d.path)}/` : ''}${value}`);
      if (!fromRoot) continue;
      const first = fromRoot.split('/')[0];
      if (DEFAULT_EXCLUDED_DIRS.has(first) || fromRoot.startsWith('storage/') || fromRoot.startsWith('bootstrap/cache')) continue;
      if (reader.exists(fromRoot) || (fromDoc && reader.exists(fromDoc))) continue;
      // A partial path such as "features/" is usually relative to some other directory (src/, app/, ...).
      if (scan.files.some((f) => f.path.startsWith(`${fromRoot}/`) || f.path.includes(`/${fromRoot}/`) || f.path.endsWith(`/${fromRoot}`))) continue;
      if (reported.has(fromRoot)) continue;
      reported.add(fromRoot);
      findings.push(finding('warning', 'stale', 'missing-path-reference', `${d.path} references ${fromRoot}, which does not exist`,
        'The path is quoted in the instructions but is not in the repository. Heuristic: medium confidence (it may be an example).',
        [{ path: d.path, line: ref.line }], 'Fix the path or remove the reference.'));
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
    findings.push(finding('warning', 'unsafe', 'sensitive-file-not-ignored', `${s.path} (${s.reason}) is not covered by ignore rules`,
      'ContextAnvil did not read it. Verify the file is not tracked by git and is listed in .gitignore.', [{ path: s.path }], 'Add it to .gitignore (and remove it from history if it was committed).'));
  }
  if (!scan.files.some((f) => f.path === '.gitignore')) {
    findings.push(finding('info', 'unsafe', 'no-gitignore', 'No .gitignore at the repository root', 'Without ignore rules, build output and local files may end up in agent context.', [], 'Add a .gitignore.'));
  }
  for (const f of facts.filter((x) => x.kind === 'script' && x.data.runsOnInstall)) {
    findings.push(finding('info', 'unsafe', 'install-time-script', `Script "${f.data.name}" runs automatically during install`,
      'ContextAnvil never executes it, but agents that run an install will.', [{ path: f.evidence[0].path, line: f.evidence[0].line }]));
  }
  for (const f of facts.filter((x) => x.kind === 'config' && x.data.category === 'agent')) {
    const text = reader.read(f.source) ?? '';
    const hooks = /"hooks"\s*:/.test(text);
    const mcp = /"mcpServers"\s*:|"servers"\s*:/.test(text) || /mcp\.json$/.test(f.source);
    if (hooks || mcp) {
      findings.push(finding('info', 'unsafe', 'agent-executable-config', `${f.source} can run commands on an agent's behalf`,
        `${hooks ? 'It defines hooks. ' : ''}${mcp ? 'It configures MCP servers. ' : ''}Review the commands before trusting this repository with an agent.`, [{ path: f.source }]));
    }
  }

  // ---- scan quality ----------------------------------------------------------
  for (const diag of scan.diagnostics) {
    if (['malformed-json', 'instruction-unreadable', 'file-limit', 'depth-limit', 'symlink-escape', 'unreadable-directory', 'file-too-large', 'detector-failed'].includes(diag.code)) {
      findings.push(finding(diag.level === 'error' ? 'error' : 'warning', 'scan', diag.code, diag.message, 'This limits how complete the analysis is.', diag.path ? [{ path: diag.path, line: diag.line }] : []));
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
  return { schemaVersion: DOCTOR_SCHEMA_VERSION, tool: { name: TOOL_NAME, version: VERSION }, root: scan.root, summary, findings: sorted };
}

/** Exit status for `doctor`: true when findings reach the chosen threshold. */
export function exceedsThreshold(report, failOn) {
  if (failOn === 'never') return false;
  if (failOn === 'error') return report.summary.error > 0;
  return report.summary.error + report.summary.warning > 0;
}
