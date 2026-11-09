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

### Phase 1.2: cross-platform validation and independent evaluation (v0.1.1+)

- GitHub Actions run green on Ubuntu, macOS and Windows with Node.js 22, 24 and 26, including a byte-identical output digest across all nine.
- An independent ranking evaluation with frozen labels from real commit history (`bench/external/`); its sobering result is recorded.
- Compile-time investigation (`docs/performance.md`) and a deterministic `--max-content-files` bound.
- **Designs written, not implemented:** [deadlines and partial results](design/deadlines-and-partial-results.md) and
  [persistent manifests](design/phase-2-manifests.md).

## Planned (not implemented)

### Phase 2: persistent manifests and live diffs

The [manifest implementation](design/phase-2-manifests.md) adds explicit
create, verify, live diff and update. Snapshots persist provenance and hashes
outside the scanned tree. Refresh reconstructs live state and skips an
identical write. A verified incremental read cache and safe generation of
instruction files remain future work.

### Phase 3: MCP server

The [stdio adapter](mcp.md) exposes `project_scan`, `get_task_context` and
`context_doctor` through exact startup-authorized repository aliases.
Workers bound and isolate synchronous analysis from protocol handling.
Claude Code connection and a native Codex tool call were verified.
The [model-driven A/B evaluation](evaluation/agent-workflows.md) remains pending.

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
- Reducing compile time at several thousand files (profile first; the 2.3 s at 5,000 files in v0.1.1 is mostly content reads).
- Optional file snippets in context packs (with the same redaction and budget accounting).
- Reading `.git/info/exclude` and the global excludes file.
- Opt-in inclusion of default-excluded directory names such as `build/`.
- Pluggable tokenizer for exact token counts, as an optional adapter.
- Optional semantic matching, if it can be made local, deterministic, explainable and opt-in.
- A wall-clock deadline for scans.
- Independent labels for the ranking benchmark, and a larger set of real repositories.

Priorities depend on user feedback; open an issue to argue for a change.
