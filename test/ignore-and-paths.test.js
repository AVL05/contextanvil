import assert from 'node:assert/strict';
import path from 'node:path';
import { test } from 'node:test';
import { isIgnoredBy, parseIgnore } from '../src/core/ignore.js';
import { isInside, normalizeRelative, toPosix } from '../src/core/paths.js';

const ignored = (patterns, rel, isDir = false) => isIgnoredBy([{ base: '', rules: parseIgnore(patterns) }], rel, isDir);

test('gitignore: basename patterns match at any depth', () => {
  assert.equal(ignored('*.log', 'a/b/c.log'), true);
  assert.equal(ignored('*.log', 'a/b/c.txt'), false);
  assert.equal(ignored('secret.txt', 'deep/dir/secret.txt'), true);
});

test('gitignore: anchored and directory-only patterns', () => {
  assert.equal(ignored('/build', 'build', true), true);
  assert.equal(ignored('/build', 'src/build', true), false);
  assert.equal(ignored('cache/', 'cache', true), true);
  assert.equal(ignored('cache/', 'cache', false), false, 'a trailing slash matches directories only');
  assert.equal(ignored('docs/generated', 'docs/generated', true), true);
  assert.equal(ignored('docs/generated', 'other/docs/generated', true), false, 'a pattern with an inner slash is anchored');
});

test('gitignore: ** wildcards', () => {
  assert.equal(ignored('**/temp', 'a/b/temp', true), true);
  assert.equal(ignored('logs/**', 'logs/x/y.txt'), true);
  assert.equal(ignored('a/**/z.txt', 'a/z.txt'), true);
  assert.equal(ignored('a/**/z.txt', 'a/b/c/z.txt'), true);
  assert.equal(ignored('a/**/z.txt', 'b/z.txt'), false);
});

test('gitignore: negation, comments, escapes and classes', () => {
  assert.equal(ignored('*.js\n!keep.js', 'keep.js'), false);
  assert.equal(ignored('*.js\n!keep.js', 'drop.js'), true);
  assert.equal(ignored('# comment\n\nfoo', 'foo'), true);
  assert.equal(ignored('\\#hash', '#hash'), true);
  assert.equal(ignored('file[0-9].txt', 'file7.txt'), true);
  assert.equal(ignored('file[!0-9].txt', 'file7.txt'), false);
  assert.equal(ignored('a?c', 'abc'), true);
});

test('gitignore: nested ignore files are scoped to their directory', () => {
  const sources = [{ base: 'pkg', rules: parseIgnore('*.gen.js') }];
  assert.equal(isIgnoredBy(sources, 'pkg/x.gen.js', false), true);
  assert.equal(isIgnoredBy(sources, 'other/x.gen.js', false), false);
});

test('gitignore: malformed pattern does not throw', () => {
  assert.doesNotThrow(() => parseIgnore('[unclosed\n\\\n***'));
});

test('normalizeRelative rejects traversal, absolute and NUL paths', () => {
  for (const bad of ['../x', 'a/../../x', '/etc/passwd', 'C:\\Windows\\win.ini', 'C:/x', '..\\x', 'a\0b', '', '.', '..']) {
    assert.equal(normalizeRelative(bad), null, JSON.stringify(bad));
  }
});

test('normalizeRelative normalises separators and dot segments (Windows-style input)', () => {
  assert.equal(normalizeRelative('src\\components\\Nav.js'), 'src/components/Nav.js');
  assert.equal(normalizeRelative('./src/./a.js'), 'src/a.js');
  assert.equal(normalizeRelative('src/dir/'), 'src/dir');
  assert.equal(normalizeRelative('a/b/../c.js'), 'a/c.js');
});

test('toPosix and isInside behave on the current platform', () => {
  const root = path.resolve('some', 'root');
  assert.equal(toPosix(path.join('a', 'b', 'c.js')), 'a/b/c.js');
  assert.equal(isInside(root, path.join(root, 'a', 'b')), true);
  assert.equal(isInside(root, root), true);
  assert.equal(isInside(root, path.resolve(root, '..', 'sibling')), false);
  assert.equal(isInside(root, path.resolve(root, '..', 'root-evil')), false, 'a shared name prefix is not containment');
  assert.equal(isInside(root, path.join(root, '..foo')), true, 'a file literally named "..foo" is inside');
});
