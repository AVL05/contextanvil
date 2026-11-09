import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { after, test } from 'node:test';
import { materialize } from '../bench/lib/materialize.js';
import { compileContext } from '../src/compiler/compile.js';
import { rolesOf } from '../src/compiler/roles.js';
import { termWeight } from '../src/compiler/relevance.js';
import { INTENT_WEIGHTS, classifyIntent, contentNeedle, matchTerm } from '../src/compiler/terms.js';
import { scanRepository } from '../src/scanner.js';
import { REPO_ROOT } from './helpers.js';

const BENCH = path.join(REPO_ROOT, 'bench');
const cleanups = [];
after(() => cleanups.forEach((c) => c()));

function load(source) {
  const repo = materialize(BENCH, source);
  cleanups.push(repo.cleanup);
  return scanRepository(repo.dir);
}
const shop = load({ bundle: 'fixtures/shop-next.bundle' });
const orders = load({ bundle: 'fixtures/orders-laravel.bundle' });
const cli = load({ bundle: 'fixtures/plugin-cli.bundle' });
const self = load({ snapshot: 'snapshots/contextanvil-0.1.0.json' });

const rank = (scan, task) => compileContext(scan, task, { budget: '4096kb', top: 50 }).files.map((f) => f.path);
const topN = (scan, task, n) => rank(scan, task).slice(0, n);

// ---- building blocks --------------------------------------------------------------------------------

test('intent classification follows transparent rules and precedence', () => {
  const cases = [
    ['Document the required environment variables', 'docs'],
    ['Fix cart total rounding error', 'fix'],
    ['Fix the failing tests in checkout', 'fix'],
    ['Write tests for the checkout flow', 'test'],
    ['Refactor the useCart hook', 'refactor'],
    ['Upgrade the docker image', 'build'],
    ['Add a mobile menu', 'add'],
    ['Users get logged out too early', 'modify'],
  ];
  for (const [task, expected] of cases) assert.equal(classifyIntent(task).name, expected, task);
  assert.equal(classifyIntent('Add a rule').trigger, 'add');
  assert.equal(classifyIntent('hello world').trigger, null);
  for (const weights of Object.values(INTENT_WEIGHTS)) assert.deepEqual(Object.keys(weights).sort(), ['config', 'doc', 'source', 'test']);
});

test('term matching: abbreviations and shared roots match, unrelated prefixes do not', () => {
  assert.equal(matchTerm('navigation', 'nav'), 'prefix');
  assert.equal(matchTerm('detection', 'detectors'), 'root');
  assert.equal(matchTerm('component', 'components'), 'exact');
  assert.equal(matchTerm('scanner', 'scan'), 'prefix');
  assert.equal(matchTerm('apply', 'app'), null, 'a different word that merely starts the same');
  assert.equal(matchTerm('user', 'use'), null);
  assert.equal(matchTerm('order', 'border'), null);
  assert.equal(contentNeedle('detection'), 'detect');
  assert.equal(contentNeedle('scanner'), 'scanner');
});

test('term weights grow as terms get rarer and stay within bounds', () => {
  let previous = Infinity;
  for (const df of [0, 1, 3, 10, 30, 60]) {
    const w = termWeight(df, 60);
    assert.ok(w <= previous && w >= 1 && w <= 2.5, `df=${df} weight=${w}`);
    previous = w;
  }
  assert.equal(termWeight(60, 60), 1);
});

test('roles come from structural path conventions only', () => {
  assert.deepEqual(rolesOf('resources/views/orders/index.blade.php'), ['view']);
  assert.deepEqual(rolesOf('app/Http/Controllers/OrderController.php'), ['endpoint']);
  assert.deepEqual(rolesOf('app/Policies/OrderPolicy.php'), ['auth']);
  assert.deepEqual(rolesOf('src/utils/helpers.js'), []);
  assert.deepEqual(rolesOf('src/modelling.js'), [], 'a name that merely contains a role word has no role');
});

// ---- realistic development tasks ----------------------------------------------------------------------

test('Vue example: the detector that lists frameworks outranks the generic scanner entry point', () => {
  // The headline weakness of v0.1.0 (node.js ranked 4th). Solved with general signals only:
  // rare-term weighting, distinctive-term evidence, root matching of "detection"/"detectors".
  const ranked = rank(self, 'Add Vue detection to the scanner');
  assert.equal(ranked[0], 'src/detectors/node.js');
  assert.ok(ranked.slice(0, 5).includes('test/detectors.test.js'));
});

test('self repository: other realistic tasks', () => {
  assert.ok(topN(self, 'Redact JWT tokens in output', 3).includes('src/core/secrets.js'));
  assert.ok(topN(self, 'Doctor should warn when the repository has no license file', 2).includes('src/doctor.js'));
  const quiet = topN(self, 'Add a --quiet option to the CLI', 4);
  assert.ok(quiet.includes('src/cli/index.js') && quiet.includes('src/cli/help.js'));
});

test('web app: components, hooks and their tests are found by structure and imports', () => {
  assert.equal(topN(shop, 'Fix the header cart count not updating', 1)[0], 'components/Header.tsx');
  assert.ok(topN(shop, 'Fix the header cart count not updating', 4).includes('hooks/useCart.ts'));
  assert.equal(topN(shop, 'Rename the useSession hook', 1)[0], 'hooks/useSession.ts');
  assert.ok(topN(shop, 'Rename the useSession hook', 3).includes('lib/auth/session.ts'));
});

test('web app: a test-writing task puts test files first (intent)', () => {
  const ranked = rank(shop, 'Write tests for the cart totals');
  assert.ok(ranked.slice(0, 2).includes('lib/cart/totals.test.ts'), ranked.slice(0, 4).join(', '));
  const fix = rank(shop, 'Fix the cart totals');
  assert.ok(fix.indexOf('lib/cart/totals.ts') < fix.indexOf('lib/cart/totals.test.ts'), 'a fix task prefers the implementation over its test');
});

test('documentation tasks prefer documentation files', () => {
  assert.equal(topN(cli, 'Update the docs for the rules', 1)[0], 'docs/rules.md');
});

test('laravel app: mail views and jobs are found through PHP imports and view() calls', () => {
  const top = topN(orders, 'Fix the email sent when an order is placed', 4);
  for (const p of ['app/Mail/OrderConfirmationMail.php', 'resources/views/emails/order-confirmation.blade.php', 'app/Jobs/SendOrderConfirmation.php']) {
    assert.ok(top.includes(p), `${p} missing from ${top.join(', ')}`);
  }
  const relatedOf = (task, file) => compileContext(orders, task, { budget: '4096kb', top: 8 }).files.find((f) => f.path === file).related.map((r) => r.path);
  assert.ok(relatedOf('change the pricing service', 'app/Services/PricingService.php').includes('app/Http/Controllers/OrderController.php'),
    '"use App\\Services\\PricingService" resolved through the composer PSR-4 map');
  assert.ok(relatedOf('change the orders index page', 'resources/views/orders/index.blade.php').includes('app/Http/Controllers/OrderController.php'),
    "view('orders.index') resolved to the Blade file");
});

test('plugin registry: for "add" tasks the registry that registers sibling modules is an extension point', () => {
  const add = compileContext(cli, 'Add a new rule that forbids TODO comments', { budget: '4096kb', top: 10 }).files;
  const registry = add.find((f) => f.path === 'src/rules/index.js');
  assert.ok(registry.reasons.some((r) => r.kind === 'registry'), 'registry reason present');
  assert.ok(add.findIndex((f) => f.path === 'src/rules/index.js') < 3);
  const fix = compileContext(cli, 'Fix the rules', { budget: '4096kb', top: 10 }).files.find((f) => f.path === 'src/rules/index.js');
  assert.ok(!fix?.reasons.some((r) => r.kind === 'registry'), 'not for fix tasks');
});

test('top-level constants are extracted as symbols and can be matched', () => {
  const pack = compileContext(self, 'update the DEPENDENCIES table', { budget: '4096kb', top: 5 });
  const node = pack.files.find((f) => f.path === 'src/detectors/node.js');
  assert.ok(node, 'node.js found');
  assert.ok(node.reasons.some((r) => r.kind === 'symbol' && /DEPENDENCIES/.test(r.detail)), JSON.stringify(node.reasons));
});

// ---- explainability invariants -----------------------------------------------------------------------

test('every point of a score has a reason, and reasons add up to the score', () => {
  for (const [scan, task] of [[shop, 'Fix the header cart count'], [orders, 'Add pagination to the orders page'], [cli, 'Add SARIF output format'], [self, 'Add Vue detection to the scanner']]) {
    const pack = compileContext(scan, task, { budget: '4096kb', top: 12 });
    for (const f of pack.files) {
      assert.ok(f.reasons.length > 0, f.path);
      if (f.reasons.some((r) => r.kind === 'intent')) continue; // a category multiplier is applied after the additive terms
      const sum = f.reasons.reduce((n, r) => n + r.points, 0);
      assert.ok(Math.abs(sum - f.score) <= 0.05, `${f.path}: reasons sum to ${sum.toFixed(2)} but score is ${f.score}`);
    }
  }
});

test('pack explains the task analysis: intent and per-term weights', () => {
  const pack = compileContext(self, 'Add Vue detection to the scanner');
  assert.deepEqual(pack.task.intent, { name: 'add', trigger: 'add' });
  assert.deepEqual(pack.task.termWeights.map((t) => t.term), ['vue', 'detection', 'scanner']);
  const vue = pack.task.termWeights.find((t) => t.term === 'vue');
  const scanner = pack.task.termWeights.find((t) => t.term === 'scanner');
  assert.ok(vue.weight > scanner.weight, 'the rarer term weighs more');
  assert.match(pack.rendered, /- Task intent: add \(from "add"\)/);
  assert.match(pack.rendered, /vue \(x\d\.\d+, in \d+ files?\)/);
});

test('ranking is deterministic across repeated runs', () => {
  const a = JSON.stringify(compileContext(self, 'Add Vue detection to the scanner'));
  const b = JSON.stringify(compileContext(self, 'Add Vue detection to the scanner'));
  assert.equal(a, b);
});

test('the benchmark dataset only lists files that exist', () => {
  const data = JSON.parse(fs.readFileSync(path.join(BENCH, 'datasets', 'tasks.json'), 'utf8'));
  const scans = { 'shop-next': shop, 'orders-laravel': orders, 'plugin-cli': cli, 'contextanvil-0.1.0': self };
  for (const ds of data.datasets) {
    const have = new Set(scans[ds.id].files.map((f) => f.path));
    for (const t of ds.tasks) for (const p of t.relevant) assert.ok(have.has(p), `${ds.id}/${t.id}: ${p}`);
  }
});
