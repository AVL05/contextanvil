import assert from 'node:assert/strict';
import { test } from 'node:test';
import { compileContext, scanRepository } from '../src/index.js';
import { makeRepo, treeDigest } from './helpers.js';

const options = { relevanceV2: true, retrievalDiagnostics: true, budget: '8kb' };

test('bounded v2 expands across real imports in both directions and discounts barrels', (t) => {
  const repo = makeRepo({
    'launcher.tsx': "import { Panel } from './widgets';\nexport function Launchpad() { return <Panel />; }",
    'widgets/index.ts': "export { Panel } from './panel';\n".repeat(80),
    'widgets/panel.tsx': 'export function Panel() { return null; }',
    'noise.ts': "// import './launcher';\nconst text = \"import './launcher'\";\nimport { malformed",
  });
  t.after(repo.cleanup);
  const before = treeDigest(repo.root);
  const scan = scanRepository(repo.root);
  const v2 = compileContext(scan, 'Change Launchpad', options);
  assert.ok(v2.retrieval.candidates.includes('widgets/panel.tsx'));
  const panel = v2.retrieval.ranked.find((file) => file.path === 'widgets/panel.tsx');
  assert.ok(panel.reasons.some((reason) => reason.trail?.some((edge) => edge.type === 'reexport')));
  assert.ok(!v2.retrieval.ranked.find((file) => file.path === 'noise.ts')?.reasons.some((reason) => reason.kind === 'graph'));
  assert.ok(compileContext(scan, 'Change Panel', options).retrieval.candidates.includes('launcher.tsx'));
  assert.deepEqual(v2, compileContext(scan, 'Change Launchpad', options));
  assert.equal(treeDigest(repo.root), before);
});

test('v2 resolves Laravel route handlers and literal views through PSR-4', (t) => {
  const repo = makeRepo({
    'composer.json': JSON.stringify({ require: { 'laravel/framework': '^12' }, autoload: { 'psr-4': { 'App\\': 'app/' } } }),
    'routes/web.php': "<?php\nuse App\\Http\\Endpoint;\nRoute::get('/renewal', [Endpoint::class, 'display']);",
    'app/Http/Endpoint.php': "<?php\nnamespace App\\Http;\nclass Endpoint { public function display() { return view('receipt'); } }",
    'resources/views/receipt.blade.php': '<p>Welcome</p>',
  });
  t.after(repo.cleanup);
  const pack = compileContext(scanRepository(repo.root), 'Change renewal', options);
  const view = pack.retrieval.ranked.find((file) => file.path.endsWith('receipt.blade.php'));
  assert.ok(view?.reasons.some((reason) => reason.trail?.map((edge) => edge.type).join('/') === 'route-handler/view'));
  assert.ok(pack.budget.usedBytes <= 8192);
});

test('v2 caps high fan-out, token floods and source reads', (t) => {
  const files = Object.fromEntries(Array.from({ length: 100 }, (_, i) => [`dep${i}.js`, 'export const value = 1;']));
  files['entry.js'] = 'export function Dispatch() {}\n' + Object.keys(files).map((name) => `import './${name}';`).join('\n');
  files['dep0.js'] += "\nimport './entry.js';";
  files['hostile.js'] = 'const ' + 'a'.repeat(40000) + ';\n' + ';'.repeat(13000);
  const repo = makeRepo(files);
  t.after(repo.cleanup);
  const scan = scanRepository(repo.root);
  const pack = compileContext(scan, 'Change Dispatch', options);
  assert.ok(pack.retrieval.index.edges <= 65);
  assert.ok(pack.retrieval.index.truncatedFiles >= 2);
  assert.ok(pack.retrieval.candidates.length <= 64);
  assert.equal(compileContext(scan, 'Change Dispatch', { ...options, maxContentFiles: 0 }).retrieval.index.edges, 0);
});
