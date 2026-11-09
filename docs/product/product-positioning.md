# Product positioning

**ContextAnvil audits repository instructions against the codebase and gives
maintainers evidence they can review locally or gate in CI.**

The primary user is a developer or maintainer who owns AGENTS.md, CLAUDE.md
or related repository guidance. The problem is drift: scripts are renamed,
paths disappear, package-manager guidance diverges, and copied instructions
can introduce unsafe content. Start with `doctor`, inspect the cited
evidence, then edit the repository yourself.

## Stable workflows

| Workflow | Capability | Boundary |
| --- | --- | --- |
| Audit agent guidance | `doctor` reports missing or weak guidance, package-manager contradictions, stale path and script references, and suspicious or sensitive text | Heuristics identify review candidates. Arbitrary semantic contradictions and all unsafe instructions are outside the guarantee |
| Inspect project context | `scan` inventories languages, frameworks, manifests, scripts, entry points, configuration and instruction files | Coverage varies by ecosystem. Node and PHP manifest detection is deeper than generic language detection |
| Hand off evidence for a task | `context` produces a bounded, ranked pack with evidence, observed or inferred status, and omissions | Selection is heuristic and misses relevant files. The evidence supports reviewing the pack, not predictions about agent quality |
| Record and verify drift | `manifest create`, `verify`, `diff`, and `update` track files and fact fingerprints against live reconstruction | Diffs indicate snapshot drift. They do not prove that prose is stale or determine how to fix it |

The differentiation is the combination of repository-aware instruction
diagnostics, traceable findings, and explicit snapshot verification in
one dependency-free CLI. A lint report can be reviewed independently of
an agent or provider. Snapshot verification stays useful even when no
coding agent is running.

## First-run path

1. Run `doctor --fail-on never` to inspect a repository and learn which
   findings are applicable.
2. Use `doctor --json --fail-on error` when integrating the audit in CI.
   Pin the tool version and review the threshold before treating heuristic
   warnings as failures.
3. Use `scan --json` when a custom report needs detected facts. Use
   `context` when preparing a specific task handoff.
4. Create a manifest outside the scanned tree. Use `verify` to gate drift
   and `diff` to investigate it. Update only after reviewing changes.

The [security model](../security.md) describes the boundary for reviewing
untrusted repositories. Review outputs before sharing them. Repository
names, paths, excerpts and detected configuration can be sensitive even
when token patterns were redacted.

## Evidence and scope

The stable product can claim deterministic local analysis under the tested
conditions, explicit provenance, and read-only analysis. Its manifests
reconstruct live state and skip an identical write. No read-avoidance cache
or persisted source of truth is in the product.

The frozen external ranking evaluation measured v0.1.1 at 0.43 MRR and
0.44 Recall@8 on 33 tasks with rankable changed-file labels. Repository
ownership and proxy-label limitations prevent generalization.
[Benchmark results](../../bench/external/RESULTS.md)

Relevance v2 and MCP were stopped after negative or inconclusive
experiments. The first regressed on the independent holdout. The second
connected to real clients but showed no spontaneous adoption in the small
pilots and inconsistent benefit when prompted. The archived results do
not support claims about better answers, productivity, or token savings.
[Experimental history](../roadmap.md)
