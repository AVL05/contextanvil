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
- **CI** for Linux, macOS and Windows with Node 22, 24 and the current LTS, including a cross-platform output
  digest comparison (its first remote results are recorded under Phase 1.2).
- **Public API contract tests** pinning the exported names and result shapes.

### Phase 1.2: cross-platform validation and independent evaluation (v0.1.1+)

- GitHub Actions run green on Ubuntu, macOS and Windows with Node.js 22, 24 and 26, including a byte-identical output digest across all nine.
- An independent ranking evaluation with frozen labels from real commit history (`bench/external/`); its sobering result is recorded.
- Compile-time investigation (`docs/performance.md`) and a deterministic `--max-content-files` bound.
- **Design written, not implemented:** [deadlines and partial results](design/deadlines-and-partial-results.md).

### Phase 2 (partly implemented): persistent manifests and live diffs

The [manifest implementation](design/phase-2-manifests.md) adds explicit `manifest create`, `verify`, `diff` and `update`
commands. Snapshots persist source hashes and fact provenance outside the scanned tree; a refresh reconstructs live state
and skips the write when the bytes are identical. Manifests are review artifacts: they never supply context to the compiler.
Still not implemented: a verified incremental read cache, and safe generation of instruction files.

### Agent Skill delivery (unreleased)

ContextAnvil ships as an Agent Skill for Claude Code and OpenAI Codex (`skills/contextanvil/`), installable with
`npx skills add AVL05/contextanvil`. The Skill bundles a generated copy of the engine and a launcher that exposes only the
read-only commands. Design, installation tests and platform limitations: [docs/skill.md](skill.md). Whether the Skill saves
tokens or improves coding results has not been measured (see Phase 5).

## Planned (not implemented)

### Phase 3: MCP server

Status: **deferred.** It is not planned while the Skill is the primary delivery path, because the Skill needs no server.
The design intent below applies if that changes.

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

- A new, independently labelled, larger ranking evaluation set (third-party repositories, labels from more than one person) before any further ranking change; the Phase 1.2 set is spent.
- Ranking: limit how much weak evidence can add up (barrel files, generic words); see the analysis in `bench/README.md`.
- Static analysis of the remaining zero-overlap cases (co-change history, synonyms) if it can stay local and deterministic.
- More detectors (Python, Go, Rust, Ruby; Vue/Svelte specifics; monorepo workspace awareness).
- Import/relationship extraction beyond JavaScript, TypeScript and PHP.
- Reducing compile time at several thousand files (profile first; a cold compile of 5,000 generated files takes seconds and is
  mostly content reads, see [performance.md](performance.md)).
- A launcher command that prints redacted excerpts, so an agent can verify findings without opening secret-flagged lines
  itself (the residual risk is described in [skill.md](skill.md#known-issue-found-during-final-review)).
- Optional file snippets in context packs (with the same redaction and budget accounting).
- Reading `.git/info/exclude` and the global excludes file.
- Opt-in inclusion of default-excluded directory names such as `build/`.
- Pluggable tokenizer for exact token counts, as an optional adapter.
- Optional semantic matching, if it can be made local, deterministic, explainable and opt-in.
- A wall-clock deadline for scans.

Priorities depend on user feedback; open an issue to argue for a change.
