# Roadmap

ContextAnvil focuses on local repository-instruction audits, traceable
context and snapshot verification. See the [product positioning](product/product-positioning.md)
and [first beta readiness assessment](product/release-readiness.md).

## Stable product

- **Phase 1: analysis and auditing.** `scan` inventories the repository.
  `doctor` reports missing guidance, package-manager contradictions, stale
  references and potentially unsafe content. `context` uses the stable
  task-aware ranking and exposes its evidence and omissions.
  [Ranking decisions](decisions/0002-relevance-ranking.md) and
  [security boundaries](security.md).
- **Phase 1.2: validation.** Cross-platform CI exercises Linux, macOS and
  Windows. Historical benchmark data and independently derived changed-file
  labels remain available for comparison.
  [Benchmark history](../bench/README.md) and [external results](../bench/external/RESULTS.md).
- **Phase 2: snapshots.** Explicit create, verify, diff and update commands
  persist hashes and provenance outside the scanned tree. Refresh fully
  reconstructs the live snapshot and skips an identical write.
  [Manifest design and implementation](design/phase-2-manifests.md).

## Archived experiments

- **Relevance v2** was closed without merge after lower candidate recall
  and changed-file coverage on the independent holdout, and higher warm
  latency and memory in the 5,000-file fixture. The branch preserves the
  [postmortem and frozen benchmark evidence](https://github.com/AVL05/contextanvil/blob/fd9e0ca4f5b70a4ed4a8d9fa76e98cc47525f587/bench/relevance-v2/POSTMORTEM.md).
  [PR #6](https://github.com/AVL05/contextanvil/pull/6).
- **MCP** was closed without merge. Client connections and guided calls
  worked, but the pilots showed no spontaneous invocation and inconsistent
  utility when guided. The branch preserves the
  [discovery evaluation](https://github.com/AVL05/contextanvil/blob/4c77e20d11e500ea26eeb07008d4136f14f517ae/docs/evaluation/mcp-discovery-results.md),
  raw observations and earlier pilot reports.
  [PR #8](https://github.com/AVL05/contextanvil/pull/8).

## Next milestone

1. Finish the public beta gates, starting with private vulnerability intake
   and an exact installed-package candidate test.
2. Gather feedback on first-run audit noise, CI thresholds and snapshot
   drift reports before expanding detector coverage.
3. Prioritize small, evidenced fixes to safety and usability. Revisit
   retrieval or agent integrations only when an evaluation can demonstrate
   practical value on a representative workflow.

[Deadlines and partial results](design/deadlines-and-partial-results.md)
remain design work. Incremental read avoidance, a dashboard and automatic
instruction generation are outside the first beta.
