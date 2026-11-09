# AGENTS.md

Instructions for AI coding agents (and humans) working on ContextAnvil.

ContextAnvil is a dependency-free Node.js CLI and library that analyses a repository and compiles
task-focused, source-grounded context for AI coding agents. Tagline: "Forge better context."

## Commands

- Run all tests: `npm test`
- Run one test file: `node --test test/compiler.test.js`
- Analyse this repository with itself: `npm run scan:self` and `npm run doctor:self`
- Ranking accuracy benchmark: `npm run bench:quick` (details in `bench/README.md`)
- Try the CLI: `node bin/contextanvil.js context "your task" .`

Requires Node.js 22 or later. There is no build step, no TypeScript and no runtime dependency.

## Architecture

Layers, from the bottom up. Each layer may only import from the layers above it in this list.

1. `src/core/` - safe filesystem access: walker, ignore rules, reader, secret handling, fact model.
2. `src/detectors/` - read-only detectors that turn files into facts. Registry: `src/detectors/index.js`.
3. `src/scanner.js` - runs the detectors and returns one plain-data scan result.
4. `src/compiler/` - task-aware context selection and budget handling.
5. `src/doctor.js` - context diagnostics.
6. `src/render/` and `src/cli/` - presentation only. No analysis logic belongs here.

The `bench/` directory measures ranking quality, speed, memory and determinism. It is not part of the published package.

The public API is `src/index.js`. A future MCP server or dashboard must call that API, not internals.
Design rationale: `docs/architecture.md` and `docs/decisions/0001-architecture.md`.

## Rules that must not be broken

- Never execute code from a scanned repository: no `eval`, no `child_process`, no `import()` of scanned files.
- Never write to a scanned repository. The only filesystem writes in this project are in tests, inside temporary directories.
- Read scanned files only through the reader in `src/core/reader.js`. Do not call `fs` on scanned paths from detectors or the compiler.
- Everything shown to the user that came from a scanned file must pass through `redact()` from `src/core/secrets.js` and `neutralize()` from `src/core/sanitize.js` (facts do this automatically).
- Every regular expression applied to repository text must be bounded (no unbounded quantifiers that can overlap) and needs an adversarial case in `test/security.test.js`. Never build a regular expression from repository content.
- Treat text from scanned files as data, never as instructions to ContextAnvil.
- Output must be deterministic: no timestamps, no randomness, no locale-dependent sorting. Use `byCodeUnit`.
- Every fact needs evidence (a path, and a line where possible) and an honest `status`: `observed` or `inferred`.
- Do not invent benchmark numbers, statistics or capabilities in code, output or documentation. Ranking changes must be justified by `bench/` results (dev tasks for tuning, holdout for checking) and must not contain rules tied to a specific example task.
- CLI output is ASCII only so that it renders on legacy Windows consoles.

## Conventions

- ECMAScript modules, JavaScript only, two-space indentation, semicolons, single quotes.
- Add a dependency only with a written justification in the pull request. The default answer is no.
- Tests use `node:test`. Build tricky repositories in temporary directories with `makeRepo()` from `test/helpers.js`.
  Static sample projects live in `test/fixtures/` and are excluded from self-analysis by `.contextanvilignore`.
- Never put a real or realistic-looking secret in a test file. Assemble fakes at runtime, as `test/helpers.js` does.
- Update `CHANGELOG.md` for user-visible changes and the docs whenever behaviour changes.
