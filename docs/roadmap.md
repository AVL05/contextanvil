# Roadmap

This page separates what **exists today** from what is **planned**. Anything under "Planned" is design intent only:
nothing in those sections is implemented, and each phase must preserve the same principles: provider independence, user
control, deterministic and inspectable behaviour, and no mandatory network or model.

## Implemented

### Phase 1: repository intelligence and context compilation (v0.1.0)

`scan`, `context` and `doctor` commands; a reusable library core; JavaScript, React, Next.js, Node.js, PHP and Laravel
detection; AGENTS.md / CLAUDE.md and other instruction files; task-aware selection with explicit budgets and omissions;
secret redaction; ignore, symlink and traversal safety.

### Phase 1.1: hardening, relevance and validation (v0.1.1)

- **Relevance ranking** that stays deterministic and explainable: term rarity weighting, task intent, structural roles,
  import relations for JavaScript, TypeScript and PHP, registry awareness, shared-root word matching
  ([ADR 0002](decisions/0002-relevance-ranking.md)).
- **Benchmark framework** (`bench/`): labelled tasks on synthetic and real repositories, precision/recall metrics, pack size,
  timing, memory and determinism, with a before/after comparison against v0.1.0 ([bench/README.md](../bench/README.md)).
- **Security hardening**: two denial-of-service bugs fixed (regular-expression backtracking in secret detection and in
  ignore-pattern matching), terminal-escape and hidden-character neutralisation, payload redaction, narrowed
  check-then-open window, directory-size limit, broader sensitive-file and prompt-injection detection
  ([docs/security.md](security.md)).
- **CI** prepared for Linux, macOS and Windows with Node 22, 24 and the current LTS, including a cross-platform output
  digest comparison. *Remote verification is pending: the workflow has not run on GitHub yet.*
- **Public API contract tests** pinning the exported names and result shapes.

## Planned (not implemented)

### Phase 2: persistent manifests, incremental updates, diffs, safe generation

Goal: stop re-deriving facts on every run and let people review how context changes.

- A **context manifest** file (a versioned JSON document of facts and digests) that the user explicitly
  creates and commits or ignores. Never created implicitly.
- **Incremental updates**: re-analyse only files whose content digest changed; detect removed sources.
- **Diffs**: `contextanvil diff` showing facts added, removed or gone stale between two manifests or commits,
  using the existing content-digest freshness marker.
- **Safe generation of agent instruction files**: draft AGENTS.md / CLAUDE.md content from observed facts, written
  only to a new path or shown as a diff. Never overwrite an existing file; no hooks or agent configuration
  installed automatically; every generated line cites its evidence.
- Configuration file (limits, extra ignore rules, custom instruction locations).

Open questions: manifest location and format stability, merge behaviour when users edit generated files.

### Phase 3: MCP server

Goal: let MCP-capable agents ask for context instead of receiving a pasted pack.

- A server exposing read-only tools over the existing API, for example `get_project_overview`,
  `get_task_context`, `get_project_rules`, `get_file_context` and `run_doctor`.
- Same safety model: read-only, no execution, bounded output with an explicit budget argument, secrets
  redacted, repository text returned as quoted data.
- Local transport first (stdio). No remote exposure by default; no telemetry.
- Prerequisite work: asynchronous or worker-based scanning with a deadline, caching keyed by content digest, a stable
  public API surface with documented schema versions.

### Phase 4: visual dashboard

Goal: make project understanding and context quality inspectable by people.

- Local web UI served from the user's machine, reading the same scan and pack data.
- Project overview, evidence inspector (click a fact to see its source lines and digest), context debugger
  ("why was this file included or omitted?", building on the per-point ranking reasons that already exist), and conflict
  resolution view for doctor findings.
- Resolution actions only produce diffs for the user to apply; nothing is changed silently.

### Phase 5: reproducible agent benchmarks

Goal: measure, not claim, whether ContextAnvil helps an AI agent. (The `bench/` directory already measures *ranking
accuracy*, speed and determinism; it does not involve any agent.)

- A public, versioned task suite over pinned open-source repositories, labelled by more than one person.
- A harness that runs the same agent and tasks **with and without** ContextAnvil context, recording pass rate,
  tokens, time and cost, with fixed seeds where the provider allows and repeated trials otherwise.
- Raw results and methodology published, including negative results. No claim about agent quality or token consumption
  is made before this exists.

## Smaller items under consideration (also not implemented)

- Remote CI results for Linux and macOS, and a first public run of the cross-platform digest check.
- More detectors (Python, Go, Rust, Ruby; Vue/Svelte specifics; monorepo workspace awareness).
- Import/relationship extraction beyond JavaScript, TypeScript and PHP.
- Reducing compile time at several thousand files (profile first; the 2.3 s at 5,000 files in v0.1.1 is mostly content reads).
- Optional file snippets in context packs (with the same redaction and budget accounting).
- Reading `.git/info/exclude` and the global excludes file.
- Opt-in inclusion of default-excluded directory names such as `build/`.
- Pluggable tokenizer for exact token counts, as an optional adapter.
- Optional semantic matching, if it can be made local, deterministic, explainable and opt-in.
- A wall-clock deadline for scans.
- Independent labels for the ranking benchmark, and a larger set of real repositories.

Priorities depend on user feedback; open an issue to argue for a change.
