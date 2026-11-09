# ADR 0001: Core architecture and technology choices

- Status: accepted
- Scope: Phase 1 (repository intelligence, context compilation, CLI)

## Context

ContextAnvil should help AI coding agents understand a repository accurately and receive only relevant,
trustworthy context. Existing tools already offer indexing, memory and MCP integrations. We want to be
different in being deterministic, source-grounded, measurable and safe by default, with no mandatory model
inference, API key or cloud service. A CLI, an MCP server and a dashboard will all be needed eventually and
must share one implementation.

## Decisions

### 1. A library core with thin front ends

All behaviour lives in a library with three entry points (`scanRepository`, `compileContext`, `diagnose`)
returning plain, versioned, JSON-serialisable data. The CLI only parses arguments and renders. An MCP server
or dashboard will import the same functions.

*Rejected*: logic inside CLI command handlers (would need rewriting for MCP); a monorepo with separate core
and CLI packages (no concrete requirement yet, and it adds release overhead).

### 2. Facts with evidence, not prose

The internal representation is a list of facts, each with a claim, `observed`/`inferred` status, confidence,
evidence (path and line) and a content-digest freshness marker. Reports, context packs and diagnostics are
views over facts. This makes "why was this included?" and "is this still true?" answerable, and it prevents
fabricating architecture: no source, no fact.

*Rejected*: summarising the repository into free text (not verifiable, not diffable).

### 3. No code execution, ever, in analysis

Detectors parse static data (JSON, JSONC, INI-style EditorConfig, Markdown) and match file names. Scripts and
JavaScript/PHP configuration files are recorded but never run or evaluated. This is the foundation of the
security model, and it costs some precision (for example a `prettier.config.js` is reported as present but its
options are unknown).

### 4. All file access through one bounded reader

Detectors and the compiler cannot touch the filesystem. The reader serves only indexed paths, re-validates the
real path against the root before opening, enforces size/binary/total limits, and refuses sensitive files. Text
from the repository can therefore not steer file access (path traversal through quoted paths is structurally
impossible), and symlink escape is blocked in two places (walker and reader).

### 5. Determinism as a requirement

No timestamps, randomness or locale-dependent ordering anywhere in output. Freshness is a content digest.
Traversal is breadth-first over code-unit-sorted names so truncation is reproducible and keeps shallow files.
This enables caching, diffing (Phase 2) and trustworthy tests.

### 6. Honest budgets

There is no tokenizer, so budgets are expressed in exact UTF-8 bytes, with token counts shown only as an
explicitly labelled estimate (`ceil(bytes / 4)`). The packer measures the final rendered text and guarantees it
fits. Everything dropped or shortened is listed.

### 7. Task relevance without a model

Relevance is a transparent additive score (file name, directory, exported symbols, content mentions, coverage
bonus, explicit mention) with a stored reason for every point. It is deliberately simple and explainable.
Limitation: it is lexical; it does not understand synonyms. Semantic retrieval is out of scope for Phase 1 and
must remain optional if added.

### 8. Repository text is untrusted

Instruction files are quoted (blockquoted, with source and line range), redacted for secrets, and have hidden
characters made visible. `doctor` flags hijacking phrases, hidden characters and secrets. Nothing in scanned
text can change ContextAnvil's behaviour.

### 9. Technology

- Node.js 22+ (maintained LTS lines), JavaScript with ES modules, npm.
- **Zero runtime dependencies.** `node:util.parseArgs` for the CLI, `node:test` for tests, a small in-repo
  gitignore matcher. This minimises supply-chain exposure, which matters for a tool that reads other people's
  repositories. A dependency needs a written justification.
- No TypeScript for now: the data model is documented and JSON-schema-shaped; types can be added later via
  JSDoc without a build step.
- Synchronous I/O: simpler and deterministic for a CLI. A server front end may need to move scanning to a worker
  or add async variants (tracked in the roadmap).
- No database, Docker, authentication, cloud or AI provider in the MVP.

### 10. ASCII-only terminal output

Output is ASCII so it renders correctly on legacy Windows console code pages and in CI logs.

## Consequences

- Positive: reproducible output, explainable selection, small attack surface, easy MCP/dashboard reuse.
- Negative: lexical relevance misses semantic matches; no execution means no dynamic discovery (for example
  routes registered at runtime); synchronous scanning will need attention on very large repositories; JS/TS
  import relations only.
- Revisit when: persistent manifests are introduced (Phase 2), when the MCP server needs concurrent or
  incremental scans (Phase 3), or when a second language needs symbol-level relations.
