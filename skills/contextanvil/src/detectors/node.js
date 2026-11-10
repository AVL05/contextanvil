import { isTestPath } from '../core/classify.js';
import { byCodeUnit, normalizeRelative } from '../core/paths.js';
import { DEFAULT_EXCLUDED_DIRS } from '../core/walker.js';
import { redact } from '../core/secrets.js';

export const id = 'node';

const DEPENDENCIES = [
  // [package, kind, display name]
  ['next', 'framework', 'Next.js'], ['react', 'framework', 'React'], ['vue', 'framework', 'Vue'],
  ['nuxt', 'framework', 'Nuxt'], ['svelte', 'framework', 'Svelte'], ['@sveltejs/kit', 'framework', 'SvelteKit'],
  ['@angular/core', 'framework', 'Angular'], ['express', 'framework', 'Express'], ['fastify', 'framework', 'Fastify'],
  ['koa', 'framework', 'Koa'], ['hono', 'framework', 'Hono'], ['@nestjs/core', 'framework', 'NestJS'],
  ['vite', 'tool', 'Vite'], ['webpack', 'tool', 'webpack'], ['esbuild', 'tool', 'esbuild'],
  ['tailwindcss', 'tool', 'Tailwind CSS'], ['typescript', 'tool', 'TypeScript compiler'],
  ['eslint', 'tool', 'ESLint'], ['prettier', 'tool', 'Prettier'], ['@biomejs/biome', 'tool', 'Biome'],
  ['jest', 'test-framework', 'Jest'], ['vitest', 'test-framework', 'Vitest'], ['mocha', 'test-framework', 'Mocha'],
  ['ava', 'test-framework', 'AVA'], ['tap', 'test-framework', 'node-tap'], ['@playwright/test', 'test-framework', 'Playwright Test'],
  ['cypress', 'test-framework', 'Cypress'], ['@testing-library/react', 'test-framework', 'React Testing Library'],
];

const TEST_CONFIGS = {
  jest: /^jest\.config\./, vitest: /^vitest\.config\./, mocha: /^\.mocharc\./,
  '@playwright/test': /^playwright\.config\./, cypress: /^cypress\.config\./,
};

const LOCKFILES = [
  ['package-lock.json', 'npm'], ['npm-shrinkwrap.json', 'npm'], ['pnpm-lock.yaml', 'pnpm'],
  ['yarn.lock', 'yarn'], ['bun.lock', 'bun'], ['bun.lockb', 'bun'],
];

const INSTALL_LIFECYCLE = new Set(['preinstall', 'install', 'postinstall', 'prepare']);

function slug(name) {
  return name.toLowerCase().replace(/^@/, '').replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
}

function scriptRole(name) {
  const base = name.split(':')[0].toLowerCase();
  if (['test', 'tests', 'jest', 'vitest', 'spec'].includes(base)) return 'test';
  if (['build', 'compile'].includes(base)) return 'build';
  if (['dev', 'develop', 'serve', 'watch'].includes(base)) return 'dev';
  if (base === 'start') return 'start';
  if (['lint', 'eslint'].includes(base)) return 'lint';
  if (['format', 'fmt', 'prettier'].includes(base)) return 'format';
  if (['typecheck', 'types', 'tsc'].includes(base)) return 'typecheck';
  if (['check', 'verify', 'validate'].includes(base)) return 'check';
  return 'other';
}

function isPlainObject(v) {
  return v !== null && typeof v === 'object' && !Array.isArray(v);
}

/** Collect string leaves from an `exports` field value, bounded in depth. */
function exportTargets(value, depth = 0) {
  if (typeof value === 'string') return [value];
  if (!isPlainObject(value) || depth > 4) return [];
  const keys = Object.keys(value);
  const subpathKeys = keys.filter((k) => k.startsWith('.'));
  const scope = subpathKeys.length ? (value['.'] !== undefined ? [value['.']] : []) : Object.values(value);
  return scope.flatMap((v) => exportTargets(v, depth + 1));
}

function detectManifest(ctx, rel, pkg, isRoot) {
  const name = typeof pkg.name === 'string' ? pkg.name : null;
  ctx.addFact({
    kind: 'manifest',
    id: `manifest:${rel}`,
    claim: `Node.js package manifest${name ? ` "${name}"` : ''}${typeof pkg.version === 'string' ? ` v${pkg.version}` : ''}${pkg.private === true ? ' (private)' : ''}`,
    evidence: [{ path: rel, line: ctx.jsonLine(rel, 'name') }],
    data: { ecosystem: 'node', name, version: typeof pkg.version === 'string' ? pkg.version : null, root: isRoot },
  });
}

export function detect(ctx) {
  const nested = ctx.find((p) => p.endsWith('/package.json')).map((f) => f.path).slice(0, 20);
  const rootPkg = ctx.has('package.json') ? ctx.readJson('package.json') : undefined;

  for (const rel of nested) {
    const pkg = ctx.readJson(rel);
    if (isPlainObject(pkg)) detectManifest(ctx, rel, pkg, false);
  }
  if (!ctx.has('package.json')) return;
  if (!isPlainObject(rootPkg)) {
    ctx.addFact({
      kind: 'manifest', id: 'manifest:package.json', status: 'observed', confidence: 'low',
      claim: 'package.json is present but could not be parsed; Node.js analysis was skipped',
      evidence: [{ path: 'package.json' }], data: { ecosystem: 'node', parseable: false },
    });
    return;
  }

  detectManifest(ctx, 'package.json', rootPkg, true);
  const frameworks = ctx.shared.get('frameworks') ?? new Set();
  ctx.shared.set('frameworks', frameworks);

  // --- module system -------------------------------------------------------
  if (rootPkg.type === 'module' || rootPkg.type === 'commonjs') {
    ctx.addFact({
      kind: 'convention', id: 'convention:module-system',
      claim: rootPkg.type === 'module' ? 'JavaScript files are ES modules (package.json "type": "module")' : 'JavaScript files are CommonJS (package.json "type": "commonjs")',
      evidence: [{ path: 'package.json', line: ctx.jsonLine('package.json', 'type'), excerpt: `"type": "${rootPkg.type}"` }],
      data: { moduleSystem: rootPkg.type },
    });
  } else {
    ctx.addFact({
      kind: 'convention', id: 'convention:module-system', status: 'inferred', confidence: 'medium',
      claim: 'No "type" field in package.json: .js files default to CommonJS in Node.js',
      evidence: [{ path: 'package.json' }], data: { moduleSystem: 'commonjs' },
    });
  }

  if (isPlainObject(rootPkg.engines) && typeof rootPkg.engines.node === 'string') {
    ctx.addFact({
      kind: 'convention', id: 'convention:node-engines',
      claim: `Supported Node.js versions: ${rootPkg.engines.node}`,
      evidence: [{ path: 'package.json', line: ctx.jsonLine('package.json', 'engines', 'node') }],
      data: { node: rootPkg.engines.node },
    });
  }

  // --- package manager -----------------------------------------------------
  const lockfiles = LOCKFILES.filter(([file]) => ctx.has(file));
  const lockManagers = [...new Set(lockfiles.map(([, m]) => m))];
  const declared = typeof rootPkg.packageManager === 'string' ? rootPkg.packageManager.split('@')[0] : null;
  if (declared) {
    ctx.addFact({
      kind: 'package-manager', id: `package-manager:${declared}`,
      claim: `Package manager: ${rootPkg.packageManager} (declared)`,
      evidence: [{ path: 'package.json', line: ctx.jsonLine('package.json', 'packageManager') }, ...lockfiles.filter(([, m]) => m === declared).map(([f]) => ({ path: f }))],
      data: { manager: declared, declared: true },
    });
    if (lockManagers.length && !lockManagers.includes(declared)) {
      ctx.diag('warn', 'package-manager-mismatch', `package.json declares ${declared} but the lockfile belongs to ${lockManagers.join(', ')}`, 'package.json');
    }
  } else {
    for (const m of lockManagers) {
      ctx.addFact({
        kind: 'package-manager', id: `package-manager:${m}`,
        claim: `Package manager: ${m} (lockfile present)`,
        evidence: lockfiles.filter(([, lm]) => lm === m).map(([f]) => ({ path: f })),
        data: { manager: m, declared: false },
      });
    }
  }
  if (lockManagers.length > 1) {
    ctx.diag('warn', 'multiple-lockfiles', `Lockfiles from several package managers found: ${lockfiles.map(([f]) => f).join(', ')}`, lockfiles[0][0]);
  }
  ctx.shared.set('packageManager', declared ?? (lockManagers.length === 1 ? lockManagers[0] : null));
  ctx.shared.set('lockManagers', lockManagers);

  // --- dependencies: frameworks, tools, test frameworks ---------------------
  const sections = ['dependencies', 'devDependencies', 'peerDependencies', 'optionalDependencies'];
  const declaredDeps = new Map();
  for (const section of sections) {
    if (!isPlainObject(rootPkg[section])) continue;
    for (const [dep, range] of Object.entries(rootPkg[section])) {
      if (!declaredDeps.has(dep) && typeof range === 'string') declaredDeps.set(dep, { range, section });
    }
  }
  const rootFiles = new Set(ctx.files.map((f) => f.path));
  const rootConfigs = ctx.files.filter((f) => !f.path.includes('/')).map((f) => f.path);

  for (const [dep, kind, display] of DEPENDENCIES) {
    const d = declaredDeps.get(dep);
    if (!d) continue;
    const evidence = [{ path: 'package.json', line: ctx.jsonLine('package.json', d.section, dep), excerpt: `${dep}: ${d.range}` }];
    let detail = '';
    const data = { package: dep, range: d.range, section: d.section };

    if (dep === 'next') {
      const nextConfig = rootConfigs.find((f) => /^next\.config\.(js|mjs|cjs|ts)$/.test(f));
      if (nextConfig) evidence.push({ path: nextConfig });
      const app = [...rootFiles].filter((p) => /^(src\/)?app\/(.+\/)?(page|layout)\.(js|jsx|ts|tsx)$/.test(p)).sort(byCodeUnit);
      const pages = [...rootFiles].filter((p) => /^(src\/)?pages\/(.+\/)?(_app|index)\.(js|jsx|ts|tsx)$/.test(p)).sort(byCodeUnit);
      if (app.length) evidence.push({ path: app[0] });
      if (pages.length) evidence.push({ path: pages[0] });
      data.router = app.length && pages.length ? 'both' : app.length ? 'app' : pages.length ? 'pages' : 'unknown';
      if (data.router !== 'unknown') detail = ` (${data.router === 'both' ? 'App and Pages routers' : data.router === 'app' ? 'App Router' : 'Pages Router'})`;
    }
    if (kind === 'test-framework' && TEST_CONFIGS[dep]) {
      const cfg = rootConfigs.find((f) => TEST_CONFIGS[dep].test(f));
      if (cfg) evidence.push({ path: cfg });
    }
    if (kind === 'framework') frameworks.add(dep);
    ctx.addFact({
      kind,
      id: `${kind}:${slug(display)}`,
      claim: `${display} ${d.range}${detail} (declared in ${d.section})`,
      evidence,
      data,
    });
  }

  // Node's built-in test runner has no dependency to detect.
  const testScript = isPlainObject(rootPkg.scripts) && typeof rootPkg.scripts.test === 'string' ? rootPkg.scripts.test : '';
  let nodeTestEvidence = /\bnode(?:\s+--?\S+)*\s+--test\b|\bnode\s+--test\b/.test(testScript)
    ? { path: 'package.json', line: ctx.jsonLine('package.json', 'scripts', 'test'), excerpt: testScript }
    : null;
  if (!nodeTestEvidence) {
    const candidates = ctx.find((p) => /\.(c|m)?js$/.test(p) && isTestPath(p)).slice(0, 25);
    for (const f of candidates) {
      const line = ctx.lineOf(f.path, /(?:from\s+|require\()\s*['"]node:test['"]/);
      if (line) {
        nodeTestEvidence = { path: f.path, line, excerpt: "imports 'node:test'" };
        break;
      }
    }
  }
  if (nodeTestEvidence) {
    ctx.addFact({
      kind: 'test-framework', id: 'test-framework:node-test',
      claim: 'Node.js built-in test runner (node:test)', evidence: [nodeTestEvidence], data: { package: null },
    });
  }

  // --- scripts (never executed) --------------------------------------------
  const scripts = {};
  if (isPlainObject(rootPkg.scripts)) {
    for (const name of Object.keys(rootPkg.scripts).sort(byCodeUnit).slice(0, 40)) {
      const command = rootPkg.scripts[name];
      if (typeof command !== 'string') continue;
      scripts[name] = command;
      const role = scriptRole(name);
      const safe = redact(command);
      ctx.addFact({
        kind: 'script', id: `script:${name}`,
        claim: `Script "${name}": ${safe.length > 120 ? `${safe.slice(0, 117)}...` : safe}`,
        evidence: [{ path: 'package.json', line: ctx.jsonLine('package.json', 'scripts', name) }],
        data: { name, command: safe, role, runsOnInstall: INSTALL_LIFECYCLE.has(name) },
      });
    }
  }
  ctx.shared.set('scripts', scripts);

  // --- entry points ----------------------------------------------------------
  const seen = new Set();
  const addEntry = (field, target, kindLabel, line) => {
    if (typeof target !== 'string' || target.includes('*')) return;
    const rel = normalizeRelative(target);
    if (!rel || seen.has(rel)) return;
    if (ctx.has(rel)) {
      seen.add(rel);
      ctx.addFact({
        kind: 'entrypoint', id: `entrypoint:${rel}`,
        claim: `${kindLabel}: ${rel}`,
        evidence: [{ path: 'package.json', line, excerpt: `${field}: ${rel}` }, { path: rel }],
        data: { path: rel, via: field },
      });
    } else if (!DEFAULT_EXCLUDED_DIRS.has(rel.split('/')[0])) {
      ctx.diag('warn', 'entrypoint-missing', `package.json "${field}" points to ${redact(rel).slice(0, 80)}, which does not exist`, 'package.json', { line });
    }
  };
  addEntry('main', rootPkg.main, 'Package main', ctx.jsonLine('package.json', 'main'));
  addEntry('module', rootPkg.module, 'Package module', ctx.jsonLine('package.json', 'module'));
  for (const t of exportTargets(rootPkg.exports)) addEntry('exports', t, 'Package export', ctx.jsonLine('package.json', 'exports'));
  if (typeof rootPkg.bin === 'string') addEntry('bin', rootPkg.bin, 'CLI binary', ctx.jsonLine('package.json', 'bin'));
  else if (isPlainObject(rootPkg.bin)) {
    for (const [bin, target] of Object.entries(rootPkg.bin).sort((a, b) => byCodeUnit(a[0], b[0]))) {
      addEntry('bin', target, `CLI binary "${bin}"`, ctx.jsonLine('package.json', 'bin', bin));
    }
  }
  for (const name of ['start', 'dev']) {
    const m = /^(?:node|nodemon|tsx|ts-node|bun)\s+(?:--?\S+\s+)*([\w./-]+\.(?:c|m)?[jt]s)\b/.exec(scripts[name] ?? '');
    if (m) addEntry(`scripts.${name}`, m[1], `Entry run by "${name}" script`, ctx.jsonLine('package.json', 'scripts', name));
  }

  if (frameworks.has('next')) {
    const nextEntries = [...rootFiles]
      .filter((p) => /^(src\/)?(app\/layout|app\/page|pages\/_app|pages\/index|middleware)\.(js|jsx|ts|tsx)$/.test(p))
      .sort(byCodeUnit);
    for (const rel of nextEntries) {
      if (seen.has(rel)) continue;
      seen.add(rel);
      ctx.addFact({
        kind: 'entrypoint', id: `entrypoint:${rel}`,
        claim: `Next.js framework entry: ${rel}`,
        evidence: [{ path: rel }, { path: 'package.json', line: ctx.jsonLine('package.json', 'dependencies', 'next') }],
        data: { path: rel, via: 'next' },
      });
    }
  }

  if (!seen.size) {
    const guesses = ['index.js', 'src/index.js', 'server.js', 'app.js', 'src/main.js', 'src/server.js', 'index.ts', 'src/index.ts', 'src/main.ts'];
    for (const rel of guesses.filter((g) => ctx.has(g)).slice(0, 2)) {
      ctx.addFact({
        kind: 'entrypoint', id: `entrypoint:${rel}`, status: 'inferred', confidence: 'low',
        claim: `Possible entry point by conventional file name: ${rel} (no manifest field points to it)`,
        evidence: [{ path: rel }], data: { path: rel, via: 'conventional-name' },
      });
    }
  }

  // --- workspaces ------------------------------------------------------------
  const ws = Array.isArray(rootPkg.workspaces) ? rootPkg.workspaces : isPlainObject(rootPkg.workspaces) && Array.isArray(rootPkg.workspaces.packages) ? rootPkg.workspaces.packages : null;
  if (ws) {
    ctx.addFact({
      kind: 'convention', id: 'convention:workspaces',
      claim: `Workspaces declared: ${ws.filter((w) => typeof w === 'string').join(', ')}. Only the root package.json is analysed in depth.`,
      evidence: [{ path: 'package.json', line: ctx.jsonLine('package.json', 'workspaces') }],
      data: { workspaces: ws.filter((w) => typeof w === 'string') },
    });
  }
}
