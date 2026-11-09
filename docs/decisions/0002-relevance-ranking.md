# ADR 0002: Deterministic, explainable relevance ranking

- Status: accepted
- Scope: Phase 1.1 (`src/compiler/relevance.js`, `terms.js`, `roles.js`, `analyze.js`)
- Builds on: [ADR 0001](0001-architecture.md)

## Context

The v0.1.0 ranker scored files from word matches in file names, directory names, exported symbols and a small content
bonus. Its documented weakness: for "Add Vue detection to the scanner" the module that actually lists frameworks
(`src/detectors/node.js`) ranked fourth, behind `src/scanner.js` and its test, because the word "scanner" appeared in a
file name while "Vue" appeared only inside file content.

We need better ranking without embeddings, vector databases, external AI APIs or heavyweight parsers, and without
losing the ability to explain why a file was chosen.

## Decision

Keep an additive, rule-based score where every point has a recorded reason, and add signals that are general rather than
tied to any example:

1. **Term weight from document frequency.** A term found in few files is better evidence than one found everywhere
   (`1 + 0.5 x log10((files + 1) / (files matching + 1))`, between 1 and 2.5). The strength 0.5 was chosen by ablation over
   development tasks; 1.0 over-rewarded coincidences.
2. **Content evidence with occurrence counts**, scaled by that weight, instead of a flat bonus.
3. **Distinctive-term evidence.** A term in at most 20% of files adds weight to a file that contains it, but only when the
   file also matches another term. This is what lets "Vue" matter without letting a one-off coincidence (a test named
   `lists_every_item`) dominate.
4. **Looser word matching**: shared-root matching (`detection` / `detectors`) and content needles for long words, while
   tightening the prefix rule (`app` no longer matches `apply`).
5. **Declared symbols include top-level constants** (registries, tables) as well as functions and classes.
6. **Task intent from transparent keyword rules** (`docs`, `fix`, `test`, `refactor`, `build`, `add`, default `modify`)
   changing how much each file *category* counts. A documentation task prefers documentation; a test-writing task prefers
   tests. Intent never selects files by itself.
7. **Structural roles from conventional paths** (views, controllers/routes, models, migrations, policies/middleware, mail,
   jobs/commands, request validation, configuration) paired with the words tasks use for them ("page" and "list" point at
   views). A role is a hint worth +1.5 per matched task word (at most two) and only on a file that already matches.
8. **Import relations**, now also for PHP (`use` through composer PSR-4, same-namespace references, Laravel `view()` calls):
   tests of, importers of, and dependencies of the strongest candidates get a small capped boost.
9. **Registry awareness for "add" tasks.** A module that imports three or more siblings from its own directory is the
   extension point for new additions and is boosted when its directory or its members match the task.

Directory proximity (boosting siblings of a strong match) was considered and deliberately not implemented: the registry and
relation signals cover the cases seen so far, and it is a rule that is hard to explain. It was not evaluated.

## Method and evidence

Changes were developed against a benchmark (`bench/`) with hand-labelled tasks on four repositories, split into `dev` and
`holdout` tasks, and compared with the unchanged v0.1.0 engine on the same harness. Constants were chosen by ablation on
`dev` tasks only. Results and caveats are in `bench/README.md`. Short version: ranking metrics improved on synthetic
repositories including held-out tasks; on one real repository they improved on most metrics, but R-precision on its four
held-out tasks fell (0.29 to 0.21). No claim is made about AI agent outcomes.

## Rejected alternatives

- **Embeddings / vector search / LLM re-ranking.** Violates the offline, deterministic, no-key principles, and makes
  rankings hard to explain. May return later as an *optional* adapter (roadmap), never as a requirement.
- **A learned model trained on the benchmark.** Eight real tasks cannot support it and it would defeat explainability.
- **Full parsing (ASTs) for symbols and imports.** Heavy dependencies for a modest gain; regular expressions over declarations
  are good enough for ranking and are bounded against hostile input.
- **Task-specific rules** (for example special-casing "Vue" or a framework name in the scorer). Explicitly forbidden; the
  Vue example must pass through general signals only.

## Consequences

- Positive: better accuracy on the measured tasks, every point explainable, no new dependencies, still deterministic.
- Negative: more constants to maintain (all in one file, documented in the table in `docs/architecture.md`); compile time grew
  because more files are read and more signals are scored (about 3x at 5,000 generated files); packs are somewhat larger because they carry
  more explanation.
- Risks: overfitting to a small, author-labelled benchmark. Mitigations: holdout split, public ablation notes, labelled
  limitations, and a rule that regression tests use tasks that were not used for tuning.
- Revisit when: a second contributor can label tasks independently, or when agent-based experiments (Phase 5) show that
  ranking accuracy does or does not matter for outcomes.
