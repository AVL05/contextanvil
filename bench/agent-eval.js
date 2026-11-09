import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const [action, destination, caseId, arm] = process.argv.slice(2);
const cases = [
  { id: 'slugify', prompt: 'Update slugify so leading and trailing whitespace does not produce hyphens. Preserve lowercasing and internal whitespace collapsing.', relevant: ['src/string-utils.js'] },
  { id: 'greet', prompt: 'Update greet so an empty or whitespace-only name produces "hello stranger". Preserve the existing output for nonblank names.', relevant: ['src/index.js', 'test/index.test.js'] },
];
const fixture = fileURLToPath(new URL('../test/fixtures/node-lib', import.meta.url));
assert.ok(destination, 'Use prepare <new-directory>, grade <directory> <case> <A|B>, or summarize <observations.json>.');

if (action === 'prepare') {
  const root = path.resolve(destination);
  fs.mkdirSync(root);
  for (const item of cases) {
    for (const variant of ['A', 'B']) {
      fs.cpSync(fixture, path.join(root, item.id + '-' + variant), { recursive: true, errorOnExist: true, force: false });
    }
  }
  fs.writeFileSync(path.join(root, 'cases.json'), JSON.stringify(cases, null, 2) + '\n', { flag: 'wx' });
} else if (action === 'grade') {
  // This executes the edited fixture, only on explicit operator request.
  assert.ok(cases.some((item) => item.id === caseId) && ['A', 'B'].includes(arm));
  const repo = path.resolve(destination, caseId + '-' + arm);
  if (caseId === 'slugify') {
    const { slugify } = await import(pathToFileURL(path.join(repo, 'src/string-utils.js')));
    assert.equal(slugify('  Hello   World  '), 'hello-world');
    assert.equal(slugify(' \t '), '');
    assert.equal(slugify('A B'), 'a-b');
  } else {
    const { greet } = await import(pathToFileURL(path.join(repo, 'src/index.js')));
    assert.equal(greet(''), 'hello stranger');
    assert.equal(greet(' \t '), 'hello stranger');
    assert.equal(greet('a'), 'hello a');
  }
  console.log(JSON.stringify({ caseId, arm, correct: true }));
} else if (action === 'summarize') {
  const observations = JSON.parse(fs.readFileSync(destination, 'utf8'));
  assert.ok(Array.isArray(observations));
  const rows = observations.map(({ caseId, arm, correct, discovered, toolCalls, contextBytes, elapsedMs, contextAnvilCalls, apiTokens }) => {
    const item = cases.find((entry) => entry.id === caseId);
    assert.ok(item && ['A', 'B'].includes(arm) && Array.isArray(discovered));
    assert.ok(typeof correct === 'boolean');
    assert.ok([toolCalls, contextBytes, elapsedMs, contextAnvilCalls].every((n) => Number.isFinite(n) && n >= 0));
    return { caseId, arm, correct, relevantDiscovered: item.relevant.filter((file) => discovered.includes(file)).length,
      relevantTotal: item.relevant.length, toolCalls, contextBytes, elapsedMs, contextAnvilCalls,
      apiTokens: Number.isFinite(apiTokens) && apiTokens >= 0 ? apiTokens : null };
  });
  console.log(JSON.stringify(rows, null, 2));
} else {
  throw new Error('Unknown evaluation action.');
}
