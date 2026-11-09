#!/usr/bin/env node
/**
 * Builds relevance labels for ranking evaluation from REAL commit history.
 *
 *   node bench/external/select.js --out bench/external/labels.json alias=/path/to/repo [alias=/path/to/repo ...]
 *
 * Idea: when a developer fixed a bug or built a feature, the files that commit modified are the files that
 * mattered for that task. The label is therefore defined by someone else (the commit author, in the past), not by the
 * ranker's author and not by looking at ranker output. The task text is the commit subject.
 *
 * Every rule below is mechanical and was fixed BEFORE any evaluation was run. Nothing here calls the ranker; the only
 * ContextAnvil code used is the file classifier, to record which files are text the ranker can rank at all.
 *
 * Rules
 *  - Newest-first walk of the first-parent history of HEAD, at most 400 commits, non-merge, exactly one parent.
 *  - Subject must be 20 to 120 characters; after removing a leading conventional-commit prefix ("feat(scope): ")
 *    at least 12 characters must remain; subjects about merges, reverts, releases, version bumps, dependency updates,
 *    lockfiles or "wip" are skipped.
 *  - Changed files are taken from the commit with renames disabled. Lockfiles, build output, snapshots, media and
 *    fonts are ignored. Files the commit ADDED are ignored (they did not exist yet, so no ranker could return them);
 *    modified and deleted files are the labels.
 *  - The commit must have 1 to 8 remaining changed files in total and at least one label.
 *  - Of the commits that pass, every third (1st, 4th, 7th ...) is kept, up to 12 per repository.
 *  - Task text = subject without the conventional-commit prefix. The prefix is metadata, not something a person types
 *    when asking for work.
 *
 * Output is deterministic for a given history.
 */
import { spawnSync } from 'node:child_process';
import crypto from 'node:crypto';
import fs from 'node:fs';
import { classifyFile } from '../../src/core/classify.js';

const MAX_WALK = 400;
const PER_REPO = 12;
const STRIDE = 3;

const args = process.argv.slice(2);
const outIndex = args.indexOf('--out');
const out = outIndex === -1 ? null : args[outIndex + 1];
const repos = args.filter((a, i) => /^[\w.-]+=/.test(a) && i !== outIndex + 1).map((a) => [a.slice(0, a.indexOf('=')), a.slice(a.indexOf('=') + 1)]);
if (!out || !repos.length) {
  console.error('usage: node bench/external/select.js --out labels.json alias=/path/to/repo ...');
  process.exit(2);
}

function git(repo, ...gitArgs) {
  const r = spawnSync('git', ['-C', repo, ...gitArgs], { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 });
  if (r.status !== 0) throw new Error(`git ${gitArgs.join(' ')} failed in ${repo}: ${r.stderr.slice(0, 200)}`);
  return r.stdout;
}

const PREFIX = /^(feat|fix|docs|style|refactor|perf|test|tests|build|ci|chore|revert)(\([^)]*\))?!?:\s*/i;
const SKIP_SUBJECT = /^(merge|revert|release|bump|wip|fixup)|\b(dependabot|lockfile|deps?\b|dependenc|version bump|bump version)/i;
const IGNORED_PATH = /(^|\/)(dist|build|\.next|node_modules|snapshots?|__snapshots__|test-results|playwright-report|coverage)\//i;
const IGNORED_FILE = /(^|\/)(package-lock\.json|pnpm-lock\.yaml|yarn\.lock|composer\.lock|bun\.lockb?)$|\.min\.(js|css)$|\.(png|jpe?g|gif|webp|avif|ico|svg|mp4|webm|woff2?|ttf|otf|pdf|zip|mp3|wav)$/i;
const RANKABLE = new Set(['source', 'test', 'doc', 'config']);

const labels = { selection: 'bench/external/select.js (rules in the file header)', repos: {}, tasks: [] };
for (const [alias, repo] of repos) {
  const head = git(repo, 'rev-parse', 'HEAD').trim();
  const remote = git(repo, 'remote', 'get-url', 'origin').trim().replace(/\.git$/, '').replace(/^git@github\.com:/, 'https://github.com/');
  labels.repos[alias] = { url: remote, head };
  const log = git(repo, 'log', '--first-parent', '--no-merges', `-n${MAX_WALK}`, '--format=%H%x09%P%x09%s', 'HEAD').trim().split('\n');
  let passed = 0;
  let kept = 0;
  for (const line of log) {
    const [sha, parents, subject] = line.split('\t');
    if (!subject || !parents || parents.includes(' ')) continue;
    const task = subject.replace(PREFIX, '').trim();
    if (subject.length < 20 || subject.length > 120 || task.length < 12 || SKIP_SUBJECT.test(subject)) continue;

    const changed = git(repo, 'diff-tree', '--no-commit-id', '--name-status', '-r', '--no-renames', sha).trim().split('\n').filter(Boolean)
      .map((l) => ({ status: l[0], path: l.slice(2).trim() }))
      .filter((f) => !IGNORED_PATH.test(f.path) && !IGNORED_FILE.test(f.path));
    const relevant = changed.filter((f) => f.status === 'M' || f.status === 'D');
    if (changed.length < 1 || changed.length > 8 || relevant.length < 1) continue;

    const index = passed++;
    if (index % STRIDE !== 0) continue;
    labels.tasks.push({
      id: `${alias}-${sha.slice(0, 7)}`,
      repo: alias,
      commit: sha,
      parent: parents,
      subject,
      task,
      relevant: relevant.map((f) => ({ path: f.path, status: f.status, rankable: RANKABLE.has(classifyFile(f.path).category) })),
      addedByCommit: changed.filter((f) => f.status === 'A').map((f) => f.path),
    });
    if (++kept >= PER_REPO) break;
  }
}

const body = `${JSON.stringify(labels, null, 2)}\n`;
fs.writeFileSync(out, body);
console.log(`wrote ${out}: ${labels.tasks.length} tasks; sha256 ${crypto.createHash('sha256').update(body).digest('hex')}`);
for (const [alias] of repos) console.log(`  ${alias}: ${labels.tasks.filter((t) => t.repo === alias).length} tasks`);
