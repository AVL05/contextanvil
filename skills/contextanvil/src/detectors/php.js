import { byCodeUnit } from '../core/paths.js';
import { redact } from '../core/secrets.js';

export const id = 'php';

const PACKAGES = [
  // [composer package, kind, display name]
  ['laravel/framework', 'framework', 'Laravel'],
  ['livewire/livewire', 'framework', 'Livewire'],
  ['inertiajs/inertia-laravel', 'framework', 'Inertia.js (Laravel adapter)'],
  ['pestphp/pest', 'test-framework', 'Pest'],
  ['phpunit/phpunit', 'test-framework', 'PHPUnit'],
  ['phpstan/phpstan', 'tool', 'PHPStan'],
  ['larastan/larastan', 'tool', 'Larastan'],
  ['laravel/pint', 'tool', 'Laravel Pint'],
  ['friendsofphp/php-cs-fixer', 'tool', 'PHP CS Fixer'],
];

function isPlainObject(v) {
  return v !== null && typeof v === 'object' && !Array.isArray(v);
}

function slug(name) {
  return name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
}

export function detect(ctx) {
  if (!ctx.has('composer.json')) return;
  const composer = ctx.readJson('composer.json');
  if (!isPlainObject(composer)) {
    ctx.addFact({
      kind: 'manifest', id: 'manifest:composer.json', confidence: 'low',
      claim: 'composer.json is present but could not be parsed; PHP analysis was skipped',
      evidence: [{ path: 'composer.json' }], data: { ecosystem: 'php', parseable: false },
    });
    return;
  }
  const frameworks = ctx.shared.get('frameworks') ?? new Set();
  ctx.shared.set('frameworks', frameworks);

  ctx.addFact({
    kind: 'manifest', id: 'manifest:composer.json',
    claim: `Composer manifest${typeof composer.name === 'string' ? ` "${composer.name}"` : ''}`,
    evidence: [{ path: 'composer.json', line: ctx.jsonLine('composer.json', 'name') }],
    data: { ecosystem: 'php', name: typeof composer.name === 'string' ? composer.name : null },
  });

  const sections = ['require', 'require-dev'];
  const declared = new Map();
  for (const section of sections) {
    if (!isPlainObject(composer[section])) continue;
    for (const [pkg, range] of Object.entries(composer[section])) {
      if (!declared.has(pkg) && typeof range === 'string') declared.set(pkg, { range, section });
    }
  }

  const php = declared.get('php');
  if (php) {
    ctx.addFact({
      kind: 'convention', id: 'convention:php-version',
      claim: `PHP version constraint: ${php.range}`,
      evidence: [{ path: 'composer.json', line: ctx.jsonLine('composer.json', php.section, 'php') }],
      data: { php: php.range },
    });
  }

  for (const [pkg, kind, display] of PACKAGES) {
    const d = declared.get(pkg);
    if (!d) continue;
    const evidence = [{ path: 'composer.json', line: ctx.jsonLine('composer.json', d.section, pkg), excerpt: `${pkg}: ${d.range}` }];
    if (pkg === 'laravel/framework') {
      for (const corroboration of ['artisan', 'bootstrap/app.php', 'routes/web.php']) {
        if (ctx.has(corroboration)) evidence.push({ path: corroboration });
      }
      frameworks.add('laravel');
    }
    if (pkg === 'phpunit/phpunit') {
      const cfg = ['phpunit.xml', 'phpunit.xml.dist'].find((f) => ctx.has(f));
      if (cfg) evidence.push({ path: cfg });
    }
    ctx.addFact({
      kind, id: `${kind}:${slug(display)}`,
      claim: `${display} ${d.range} (declared in composer.json ${d.section})`,
      evidence, data: { package: pkg, range: d.range, section: d.section },
    });
  }

  // PSR-4 autoload mappings: a direct statement of where namespaces live.
  const psr4 = composer.autoload?.['psr-4'];
  if (isPlainObject(psr4)) {
    for (const ns of Object.keys(psr4).sort(byCodeUnit)) {
      const dirs = [].concat(psr4[ns]).filter((d) => typeof d === 'string');
      ctx.addFact({
        kind: 'convention', id: `convention:psr4:${ns}`,
        claim: `PSR-4 autoload: namespace ${ns} maps to ${dirs.join(', ')}`,
        evidence: [{ path: 'composer.json', line: ctx.jsonLine('composer.json', 'autoload', 'psr-4', ns.replace(/\\/g, '\\\\')) }],
        data: { namespace: ns, directories: dirs },
      });
    }
  }

  // Composer scripts (never executed).
  const scripts = {};
  if (isPlainObject(composer.scripts)) {
    for (const name of Object.keys(composer.scripts).sort(byCodeUnit).slice(0, 30)) {
      const value = composer.scripts[name];
      const command = typeof value === 'string' ? value : Array.isArray(value) ? value.filter((v) => typeof v === 'string').join(' && ') : null;
      if (!command) continue;
      scripts[name] = command;
      const safe = redact(command);
      ctx.addFact({
        kind: 'script', id: `script:composer:${name}`,
        claim: `Composer script "${name}": ${safe.length > 120 ? `${safe.slice(0, 117)}...` : safe}`,
        evidence: [{ path: 'composer.json', line: ctx.jsonLine('composer.json', 'scripts', name) }],
        data: { name, command: safe, role: name === 'test' ? 'test' : 'other', runner: 'composer', runsOnInstall: /^(pre|post)-(install|update)-cmd$|^post-autoload-dump$/.test(name) },
      });
    }
  }
  ctx.shared.set('composerScripts', scripts);

  // Laravel entry points are fixed by the framework's own skeleton.
  if (frameworks.has('laravel')) {
    const entries = [
      ['public/index.php', 'HTTP entry point'], ['artisan', 'Artisan console entry point'],
      ['bootstrap/app.php', 'Application bootstrap'], ['routes/web.php', 'Web routes'],
      ['routes/api.php', 'API routes'], ['routes/console.php', 'Console routes'],
    ];
    for (const [rel, label] of entries) {
      if (!ctx.has(rel)) continue;
      ctx.addFact({
        kind: 'entrypoint', id: `entrypoint:${rel}`,
        claim: `Laravel ${label}: ${rel}`,
        evidence: [{ path: rel }, { path: 'composer.json', line: ctx.jsonLine('composer.json', 'require', 'laravel/framework') }],
        data: { path: rel, via: 'laravel' },
      });
    }
  }
}
