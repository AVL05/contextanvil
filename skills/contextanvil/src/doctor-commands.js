import { lines } from './core/markdown.js';
import { dirname, normalizeRelative } from './core/paths.js';
import { LOCKFILES } from './detectors/node.js';

const MANAGERS = new Set(['npm', 'pnpm', 'yarn', 'bun']);
const INSTALL = new Set(['install', 'i', 'ci', 'add']);
const BUILTINS = new Set([
  ...INSTALL, 'remove', 'rm', 'uninstall', 'update', 'upgrade', 'up', 'init', 'publish', 'pack', 'audit',
  'outdated', 'link', 'unlink', 'exec', 'x', 'dlx', 'create', 'config', 'cache', 'login', 'logout', 'whoami',
  'view', 'info', 'ls', 'list', 'prune', 'dedupe', 'rebuild', 'root', 'bin', 'prefix', 'doctor', 'help',
  'why', 'version', 'workspace', 'workspaces', 'patch', 'import', 'store', 'set', 'get', 'pm',
]);
const SHELLS = new Set(['', 'bash', 'sh', 'zsh', 'shell', 'console', 'powershell', 'pwsh', 'ps1', 'cmd', 'bat']);
const SELECTORS = new Set(['--filter', '-F', '--workspace', '-w', '--cwd', '--prefix', '-C', '--dir']);
const NON_DIRECTIVE = /\b(?:if (?:present|available|installed|defined|needed)|for example|e\.g\.|never run|do not run|don't run|alternatively)\b/i;

function directory(base, relative) {
  if (!relative || !/^[\w.@/ -]{1,512}$/.test(relative) || relative.startsWith('/')) return null;
  const joined = `${base}/${relative}`.replace(/^\//, '');
  const child = normalizeRelative(`${joined}/package.json`);
  return child === null ? null : dirname(child);
}

// Parse only the literal subset needed for project commands. Tokens with
// expansion, shell redirects, or unknown flags are not evidence of a script.
function* commands(text) {
  const tokens = [];
  for (const match of text.matchAll(/"[^"\r\n]{0,512}"|'[^'\r\n]{0,512}'|&&|\|\||;|[^\s;&|"'<>]{1,512}|[&|"'<>]/g)) {
    const token = match[0];
    if (token.startsWith('#')) break;
    if (token === '&&' || token === ';') {
      if (tokens.length) yield tokens.splice(0);
    } else if (['||', '|', '&', '>', '<', '"', "'"].includes(token)) {
      return;
    } else {
      tokens.push(token[0] === '"' || token[0] === "'" ? token.slice(1, -1) : token);
    }
  }
  if (tokens.length) yield tokens;
}

export function commandProjects(scan, reader) {
  const manifests = new Map(scan.files.filter((file) => file.path === 'package.json' || file.path.endsWith('/package.json'))
    .map((file) => [dirname(file.path), file.path]));
  const manifestAncestors = new Set();
  for (const scope of manifests.keys()) {
    for (let parent = dirname(scope); parent && !manifestAncestors.has(parent); parent = dirname(parent)) {
      manifestAncestors.add(parent);
    }
  }
  const names = new Map();
  const loaded = new Map();

  function load(scope) {
    if (!manifests.has(scope)) return null;
    if (!loaded.has(scope)) {
      const path = manifests.get(scope);
      let project = null;
      try {
        const pkg = JSON.parse(reader.read(path));
        if (pkg && typeof pkg === 'object' && !Array.isArray(pkg)) {
          const scriptEntries = pkg.scripts && typeof pkg.scripts === 'object' && !Array.isArray(pkg.scripts)
            ? Object.entries(pkg.scripts) : [];
          const scripts = new Set(scriptEntries.filter(([, value]) => typeof value === 'string').map(([key]) => key));
          const locks = new Map();
          for (const [name, manager] of LOCKFILES) {
            const lock = scope ? `${scope}/${name}` : name;
            if (reader.has(lock) && !locks.has(manager)) locks.set(manager, { path: lock });
          }
          const declared = typeof pkg.packageManager === 'string' ? pkg.packageManager.split('@')[0] : null;
          const manager = MANAGERS.has(declared) ? declared : locks.size === 1 ? locks.keys().next().value : null;
          const evidence = manager === declared ? [{ path }, ...(locks.has(manager) ? [locks.get(manager)] : [])] : [locks.get(manager)];
          project = { scope, path, scripts, manager, managerEvidence: manager ? evidence : [] };
          if (typeof pkg.name === 'string') names.set(pkg.name, names.has(pkg.name) ? null : scope);
        }
      } catch {
        // Scan diagnostics already report parse failures for indexed manifests.
      }
      loaded.set(scope, project);
    }
    return loaded.get(scope);
  }

  return {
    load,
    hasScript(project, { manager, name }) {
      const server = project.scope ? `${project.scope}/server.js` : 'server.js';
      return project.scripts.has(name) || (manager === 'npm' && name === 'start' && reader.has(server));
    },
    changeDirectory(base, relative) {
      const target = directory(base, relative);
      return target === '' || target === null ? target : reader.resolveDirectory(target);
    },
    nearest(scope, explicit = false) {
      if (!explicit && manifestAncestors.has(scope) && !manifests.has(scope)) return null;
      while (scope !== null) {
        if (manifests.has(scope)) return scope;
        scope = scope ? dirname(scope) : null;
      }
      return null;
    },
    workspace(base, selector) {
      const path = directory(base, selector);
      if (path !== null && manifests.has(path)) return path;
      // A selector may be a package name. Large repositories can be truncated,
      // so skip name resolution when the bounded manifest inventory is incomplete.
      if (manifests.size > 200 || scan.stats.truncated) return null;
      for (const scope of manifests.keys()) load(scope);
      const scope = names.get(selector);
      return typeof scope === 'string' && (!base || scope.startsWith(`${base}/`)) ? scope : null;
    },
  };
}

function parseInvocation(tokens, cwd, projects) {
  const [manager, ...args] = tokens[0] === '$' ? tokens.slice(1) : tokens;
  if (!MANAGERS.has(manager) || cwd === null) return null;
  let scope = projects.nearest(cwd);
  let start = 0;
  let selector = null;
  let end = args.length;
  for (let index = 0; index < args.length; index++) {
    // pnpm forwards arguments after the script name. npm can consume its
    // workspace options there until the explicit argument separator.
    const run = args[start] === 'run' || args[start] === 'run-script';
    if (manager === 'pnpm' && index > start + Number(run)) break;
    if (args[index] === '--') { end = index; break; }
    const [option, attached] = args[index].split('=', 2);
    if (['--if-present', '--workspaces', '--recursive', '-r'].includes(option)) return null;
    if (!SELECTORS.has(option)) continue;
    if (selector !== null) return null;
    const value = attached ?? args[index + 1];
    if (!value) return null;
    selector = { option, value };
    if (index === start) start += attached === undefined ? 2 : 1;
    else end = Math.min(end, index);
    if (attached === undefined) index++;
  }
  if (selector) {
    const { option, value } = selector;
    if (['--cwd', '--prefix', '-C', '--dir'].includes(option)) {
      const dir = projects.changeDirectory(cwd, value);
      scope = dir === null ? null : projects.nearest(dir);
    } else {
      const owner = projects.nearest(cwd, true);
      scope = owner === null ? null : projects.workspace(owner, value);
    }
  }
  const action = args[start];
  if (!action || start >= end) return null;
  const explicitRun = action === 'run' || action === 'run-script';
  if (!explicitRun && BUILTINS.has(action)) return INSTALL.has(action) ? { manager, scope, install: true } : null;
  const name = explicitRun && start + 1 < end ? args[start + 1] : explicitRun ? undefined : action;
  if (!name || !/^[A-Za-z][\w:.-]{0,199}$/.test(name)) return null;
  if (!explicitRun && ((manager === 'npm' && !['test', 'start', 'stop', 'restart'].includes(name))
    || (manager === 'bun' && name === 'test') || (manager === 'pnpm' && ['dlx', 'deploy', 'fetch', 'setup'].includes(name)))) return null;
  return { manager, scope, name, text: [manager, ...(explicitRun ? [action] : []), name].join(' ') };
}

export function instructionCommands(doc, projects) {
  const result = [];
  let fence = null;
  let cwd = doc.scope;
  let previous = '';
  for (const line of lines(doc.text)) {
    const text = line.text;
    const marker = /^ {0,3}(`{3,}|~{3,})([\w-]{0,24})/.exec(text);
    if (marker) {
      if (fence === null) {
        fence = { delimiter: marker[1][0], width: marker[1].length, shell: SHELLS.has(marker[2].toLowerCase()) && !NON_DIRECTIVE.test(previous) };
        cwd = doc.scope;
      } else if (marker[1][0] === fence.delimiter && marker[1].length >= fence.width && !text.slice(marker[0].length - marker[2].length).trim()) {
        fence = null;
      }
      continue;
    }
    if (text.length > 4000) continue;
    if (fence && !fence.shell) continue;
    const prose = text.replace(/`[^`\n]{1,4000}`/g, ' ');
    if (!fence && NON_DIRECTIVE.test(prose)) continue;
    const snippets = fence ? [text] : [...text.matchAll(/`([^`\n]{1,4000})`/g)].map((m) => m[1]);
    const alternative = /\bor\b/i.test(prose) && snippets.length > 1;
    for (const snippet of snippets) {
      let location = fence ? cwd : doc.scope;
      for (const tokens of commands(snippet)) {
        if (tokens[0] === 'cd') {
          const args = tokens[1] === '--' ? tokens.slice(2) : tokens.slice(1);
          location = location !== null && args.length === 1 ? projects.changeDirectory(location, args[0]) : null;
        } else if (!fence || !NON_DIRECTIVE.test(tokens.join(' '))) {
          const command = parseInvocation(tokens, location, projects);
          if (command) result.push({ ...command, line: line.number, alternative, path: doc.path });
        }
      }
      if (fence) cwd = location;
    }
    if (!fence && text.trim()) previous = prose;
  }
  return result;
}
