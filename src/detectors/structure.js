import { classifyFile } from '../core/classify.js';
import { byCodeUnit, dirname } from '../core/paths.js';

export const id = 'structure';

const LARAVEL_ROLES = new Map([
  ['app/Http/Controllers', 'Laravel controllers'],
  ['app/Http/Middleware', 'Laravel middleware'],
  ['app/Models', 'Laravel Eloquent models'],
  ['routes', 'Laravel route definitions'],
  ['database/migrations', 'Laravel database migrations'],
  ['resources/views', 'Laravel Blade views'],
  ['tests/Feature', 'Laravel feature tests'],
  ['tests/Unit', 'Laravel unit tests'],
]);

const MAX_DIRS = 24;
const MIN_FILES_BY_DEPTH = { 1: 2, 2: 3, 3: 5 };

/**
 * Reports directories that actually contain source code, with counts. A role
 * is attached only when independent evidence supports it (a detected framework
 * plus matching files); a directory name alone never produces a role.
 */
export function detect(ctx) {
  const frameworks = ctx.shared.get('frameworks') ?? new Set();
  const dirs = new Map();

  for (const f of ctx.files) {
    const { category, language } = classifyFile(f.path);
    if (!language) continue;
    const parts = dirname(f.path).split('/').filter(Boolean);
    for (let depth = 1; depth <= Math.min(parts.length, 3); depth++) {
      const key = parts.slice(0, depth).join('/');
      const d = dirs.get(key) ?? { path: key, depth, files: 0, tests: 0, jsx: 0, langs: new Map(), examples: [] };
      d.files++;
      if (category === 'test') d.tests++;
      if (/\.(jsx|tsx)$/.test(f.path)) d.jsx++;
      d.langs.set(language, (d.langs.get(language) ?? 0) + 1);
      if (d.examples.length < 2) d.examples.push(f.path);
      dirs.set(key, d);
    }
  }

  const binDirs = new Set(
    ctx.facts.filter((f) => f.kind === 'entrypoint' && f.data.via === 'bin').map((f) => dirname(f.data.path)),
  );

  /** @returns {{ role: string, status: string, confidence: string, strong: boolean } | null} */
  const roleOf = (d) => {
    if (d.tests / d.files > 0.5) {
      return { role: 'tests (majority of files match test naming)', status: 'observed', confidence: 'high', strong: false };
    }
    if (frameworks.has('next') && /^(src\/)?app$/.test(d.path)
      && ctx.files.some((f) => f.path.startsWith(`${d.path}/`) && /\/(page|layout)\.(js|jsx|ts|tsx)$/.test(f.path))) {
      return { role: 'Next.js App Router routes (page/layout files present)', status: 'observed', confidence: 'high', strong: true };
    }
    if (frameworks.has('next') && /^(src\/)?pages$/.test(d.path)) {
      return { role: 'Next.js Pages Router routes', status: 'observed', confidence: 'high', strong: true };
    }
    if (frameworks.has('laravel') && LARAVEL_ROLES.has(d.path)) {
      return { role: `${LARAVEL_ROLES.get(d.path)} (Laravel framework convention)`, status: 'inferred', confidence: 'medium', strong: true };
    }
    if (frameworks.has('react') && d.jsx / d.files >= 0.6) {
      return { role: 'React UI (majority JSX/TSX files)', status: 'inferred', confidence: 'medium', strong: false };
    }
    if (binDirs.has(d.path)) {
      return { role: 'CLI entry points (declared in package.json "bin")', status: 'observed', confidence: 'high', strong: true };
    }
    return null;
  };

  const selected = [...dirs.values()]
    .map((d) => ({ d, r: roleOf(d) }))
    .filter(({ d, r }) => d.files >= MIN_FILES_BY_DEPTH[d.depth] || r?.strong)
    .sort((a, b) => b.d.files - a.d.files || byCodeUnit(a.d.path, b.d.path))
    .slice(0, MAX_DIRS)
    .sort((a, b) => byCodeUnit(a.d.path, b.d.path));

  for (const { d, r } of selected) {
    const mix = [...d.langs.entries()].sort((a, b) => b[1] - a[1] || byCodeUnit(a[0], b[0])).map(([l, n]) => `${l} ${n}`).join(', ');
    ctx.addFact({
      kind: 'source-dir', id: `source-dir:${d.path}`,
      status: r?.status ?? 'observed', confidence: r?.confidence ?? 'high',
      claim: `${d.path}/: ${d.files} source file${d.files === 1 ? '' : 's'} (${mix})${r ? `; ${r.role}` : ''}`,
      evidence: d.examples.map((path) => ({ path })),
      data: { path: d.path, files: d.files, tests: d.tests, role: r?.role ?? null },
    });
  }
}
