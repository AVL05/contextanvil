# Changelog

All notable changes are documented here. The format follows [Keep a Changelog](https://keepachangelog.com/),
and the project aims to follow [Semantic Versioning](https://semver.org/) once it reaches 1.0.

## [Unreleased]

## [0.1.1] - Phase 1.1: hardening, relevance and validation

Not yet published to npm. Public behaviour is compatible with 0.1.0: the CLI, the exported API names and the schema
versions of scan, pack and doctor results are unchanged. Results gained fields (`task.intent`, `task.termWeights`,
per-reason `brief`) and context packs contain two additional header lines.

### Security

- **Fixed denial of service by regular-expression backtracking** in secret detection: inputs such as `a.a.a.` ...,
  `api_key` repeated, or `a.a.` before `://` made `redact()` / `findSecrets()` run for longer than 15 s on a 200 KB
  instruction file. All patterns are now bounded.
- **Fixed denial of service in ignore-pattern matching**: a `.gitignore` containing `*a*a*a*a*a*a*b` took 3.2 s
  against a 60-character name and did not finish with 10 stars. Patterns are now matched segment by segment with an
  iterative matcher, never compiled to regular expressions; overlong and over-deep patterns are skipped.
- Terminal escape sequences and other control characters, and invisible or direction-changing characters, are
  neutralised (`<U+XXXX>`) in every output; file names containing them are not indexed.
- Fact payloads, claims and evidence are all redacted (a `git+https://user:token@...` dependency range used to appear
  in JSON output).
- Ignore files that are symlinks leaving the repository are no longer read.
- File reads use `O_NOFOLLOW` where available and re-verify identity and location after opening.
- Directories with more than 20,000 entries are skipped and reported (`maxDirEntries`).
- More sensitive file names (`auth.json`, `.envrc`, `.dev.vars`, `.yarnrc.yml`, `.pgpass`, `*.p8`, `secrets/` ...).
- `doctor` detects more: terminal control characters, hidden HTML elements, link-reference comments, encoded blobs,
  role-override markers, safety-disabling and exfiltration phrasing; a negation in the same clause ("never ignore
  previous instructions") no longer produces a finding.

### Changed

- **Context relevance**: term rarity weighting, task intent classification, structural roles, shared-root word
  matching, distinctive-term evidence, top-level constants as symbols, import relations for PHP (PSR-4 `use`,
  same-namespace references, Laravel `view()`), registry awareness for "add" tasks, and relation boosts for tests
  and importers of the best candidates. A prefix match no longer treats `app` as `apply`. See
  [ADR 0002](docs/decisions/0002-relevance-ranking.md).
- Compact "why" text in Markdown packs (full detail remains in `--json`). Blank lines inside quoted instruction
  excerpts are now `>` without trailing space (the recorded benchmark pack sizes predate this and are 2 to 8 bytes
  larger than a fresh run; rankings are identical).
- Content matching reads up to 5,000 files (was 2,000), smaller files first among unmatched ones, and no longer retains
  file text.
- Compile time at several thousand files is higher than in 0.1.0 (generated 5,002 files: 0.7 s to 2.3 s on the
  development machine); see `bench/README.md`.

### Added

- `bench/`: benchmark framework with labelled tasks on three synthetic repositories and one real (frozen) repository,
  precision, recall, MRR, R-precision, pack size, timing, memory, determinism, a before/after comparison tool, a
  per-task ranking explainer and a cross-platform output digest.
- `docs/decisions/0002-relevance-ranking.md`.
- Tests: adversarial/security tests, relevance regression tests on realistic tasks, public API contract tests.
- CI: Ubuntu, macOS and Windows with Node 22, 24 and the current LTS; CLI exit-code checks; run-to-run and
  cross-platform output comparison; benchmark smoke job; Dependabot for the workflow actions. **The workflow has not
  been run on GitHub yet.**
- `npm run bench`, `bench:quick`, `bench:digest`.

### Known issues

- Real-repository ranking: on the four held-out tasks of the frozen real repository, R-precision decreased
  (0.29 to 0.21) while MRR and P@1 improved. See `bench/README.md`.
- Ranking remains lexical and structural; synonyms and domain knowledge are not understood.
- Tests that need symlinks skip themselves where the OS forbids creating them (for example Windows without developer
  mode), and one POSIX file-permission test cannot run on Windows. Linux and macOS have not been exercised yet.

## [0.1.0] - Initial development release

First implementation of Phase 1. Not published to npm.

### Added

- `contextanvil scan [path]`: deterministic repository analysis with evidence for every fact (languages,
  frameworks, manifests, entry points, scripts, test frameworks, source directories, configuration files,
  conventions, agent instruction files). Text and JSON output.
- `contextanvil context "<task>" [path]`: task-aware context packs with ranked files and reasons, applicable
  instruction excerpts, commands, conventions, separate inferred recommendations, explicit budgets
  (bytes or estimated tokens) and an explicit omissions list.
- `contextanvil doctor [path]`: diagnostics for missing, conflicting, outdated and potentially unsafe context,
  with `--fail-on` exit codes for CI.
- Detectors for JavaScript, TypeScript, React, Next.js, Node.js, PHP and Laravel, plus EditorConfig, Prettier,
  tsconfig and test-layout conventions.
- Safe traversal: `.gitignore` and `.contextanvilignore` support, default exclusion of dependencies, build output and
  caches, symlink and path-traversal protection, size/depth/file-count limits, sensitive-file exclusion, secret
  redaction.
- Library API (`src/index.js`) designed for reuse by a future MCP server and dashboard.
- Documentation: architecture, ADR 0001, roadmap, security model.
- Test suite on Node's built-in runner and a GitHub Actions workflow (Linux, macOS, Windows).
