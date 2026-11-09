# Relevance v2 regression investigation

## Development ablations (16 tasks)

| Variant | Candidate R@64 | P@1 | MRR | R-precision | 8 KiB coverage | Bytes |
| --- | ---: | ---: | ---: | ---: | ---: | ---: |
| baseline | 0.802 | 0.292 | 0.515 | 0.397 | 0.530 | 5593.917 |
| v2 | 0.802 | 0.417 | 0.577 | 0.375 | 0.443 | 5090.708 |
| no-graph-candidates | 0.802 | 0.417 | 0.577 | 0.375 | 0.443 | 5047.333 |
| union | 0.802 | 0.417 | 0.577 | 0.375 | 0.443 | 5090.708 |
| no-graph-score | 0.802 | 0.375 | 0.550 | 0.390 | 0.487 | 4855.542 |
| no-barrel | 0.802 | 0.417 | 0.577 | 0.375 | 0.443 | 5090.708 |
| legacy-pack | 0.802 | 0.417 | 0.577 | 0.375 | 0.443 | 5778.417 |

## Historical holdout post-mortem (32 tasks)

| Earliest observable loss | Relevant file-task pairs | Of which fell out of the pack |
| --- | ---: | ---: |
| candidate | 1 | 0 |
| ranking | 12 | 4 |
| budget | 0 | 0 |

Relevant candidate losses displaced from the v2 lexical top 64: 0.
New relevant candidates recovered by v2: 0.
New top-eight non-labels: 30, including 10 with graph points. Weak labels cannot establish that these files were irrelevant.
Graph-supported packed entries: 68. Repeated edge citations across their diagnostic trails: 15.
- baseline median instruction payload 0.0 B, file explanation payload 1767.0 B, labelled hits per KiB 0.2.
- v2 median instruction payload 0.0 B, file explanation payload 1159.0 B, labelled hits per KiB 0.2.

## 5,000-file fixture

| Phase | Baseline fresh ms | v2 fresh ms | Baseline warm ms | v2 warm ms |
| --- | ---: | ---: | ---: | ---: |
| path-ranking | 33.2 | 32.8 | 27.6 | 29.8 |
| read-and-extract | 1168.7 | 1038.1 | 28.1 | 41.3 |
| lexical-ranking | 35.5 | 33.2 | 28.5 | 26.2 |
| prepare-pack | 15.7 | 20.6 | 11.3 | 17.5 |
| select-and-render | 0.5 | 0.5 | 0.1 | 0.1 |
| index | - | 11.9 | - | 11.7 |
| anchors | - | 1.5 | - | 1.7 |
| traversal | - | 0.1 | - | 0.1 |
| candidates | - | 0.8 | - | 0.8 |
| rerank | - | 0.3 | - | 0.2 |

baseline: median fresh process 1373.7 ms, warm compile 96.2 ms, peak RSS 154.6 MiB.

v2: median fresh process 1254.8 ms, warm compile 128.5 ms, peak RSS 194.9 MiB.

## Findings and decision

**NO-GO. Keep v2 opt-in.** The replay reproduced the original holdout results.
Recall@64 moved from 0.720 to 0.706 (paired delta interval -4.2 to 0.0
percentage points). The 8 KiB changed-file coverage proxy moved from 0.571
to 0.514 (interval -11.1 to -2.8 points). These are exploratory intervals
over three repository clusters. No independently adjudicated essential-file
coverage is available.

- **Retrieval:** the single relevant candidate loss was Express
  `package.json` in `express-f5c159b`. It still appeared in the unbounded v2
  lexical union but was outside the v2 lexical top 64. Graph-slot reservation
  therefore does not explain this observed loss. V2 recovered no new
  labelled candidates on the historical holdout, and the bounded union
  and graph-candidate ablations produced no development recall gain.
- **Ranking:** all four observed losses from the final pack first fell
  below the eight-file shortlist. In development task `ky-0a9cbb1`,
  `test/hooks.ts` moved from 8th to 14th. Suppressing graph points alone
  restored it to 8th, while restoring pack policy did not. Across the
  development set, suppressing graph points improved R-precision and
  pack coverage, but reduced P@1 and MRR. This establishes a calibration
  trade-off, not a generally better ranking. Removing the barrel
  discount produced no material change in the development metrics.
- **Selection:** smaller packs did not preserve more labelled files.
  No observed holdout pack loss was first blocked by the byte budget.
  Restoring Phase 1.2 pack policy on development increased bytes without
  changing coverage. Repeated edge citations in diagnostic trails do not
  establish duplicate score inflation or redundant rendered text.
- **Resources:** four fresh processes per engine on one 5,000-file tree
  under Windows and Node 24.22.2. The OS cache was uncontrolled and the
  first baseline run was much slower. Warm stage timing localizes the
  overhead to extraction, index assembly and pack preparation more than
  traversal. A separate cold process sample showed v2 heap at 31 MiB
  after extraction and 48 MiB after index assembly (baseline 19 MiB
  after extraction). These samples are sensitive to garbage collection.
  The implementation holds extracted relationships and a second adjacency
  representation concurrently. Retained-size attribution would require
  heap profiling.

The diagnostic switches are internal. No ranking correction was promoted:
none of the isolated changes recovered recall without a trade-off or showed
an essential-file improvement. The new frozen corpus remains unused.
