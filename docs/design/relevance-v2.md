# Relevance v2

## Current limitations

The Phase 1.2 evaluation measured v0.1.1 at P@1 0.33, MRR 0.43, R-precision
0.21, Recall@5 0.28 and Recall@8 0.44 on 33 tasks with rankable labels.
The engine never returned 44 of 105 rankable labels. Reranking alone cannot
recover missing candidates. The historical labels describe edits and deletions,
so they can omit useful unchanged dependencies and include incidental edits.
The repositories share ownership with ContextAnvil. Treat these figures as
diagnostics and remeasure the baseline on the new corpus.

## Retrieval pipeline

1. **Index the bounded scan.** Extract declarations, exports, imports and
   resolvable references during the existing content pass. Reuse the reader,
   file classification, import extraction and term normalization. Keep an
   in-memory index scoped to the scan.
2. **Find anchors.** Start with explicit paths, qualified identifiers, route
   names and literal URL patterns, then rare identifier components and the
   existing lexical shortlist. Preserve exact matches through later caps.
   Resolve ambiguous names by module scope and local bindings. An unqualified
   common name gives weak evidence and cannot seed a second hop.
3. **Generate candidates.** Reserve slots for lexical results, exact anchors
   and structural neighbors. Expand both directions so a controller can
   retrieve its route and a changed component can retrieve its callers.
   Merge duplicate file IDs while retaining the strongest provenance per
   evidence family. Record candidates before reranking for independent recall
   measurement. If there are no reliable anchors, retain lexical retrieval
   and report the missing structural evidence.
4. **Rerank.** Combine bounded features for direct query match, resolved symbol
   use, route or entry-point role and strongest graph path. Discount inferred
   links, long paths, ambiguous matches and high-degree nodes. Count repeated
   imports or equivalent paths as one feature contribution. Keep an exact
   match to a barrel eligible, but attribute re-export evidence to its resolved
   definitions or consumers when available. A wildcard re-export supplies no
   independent vote per symbol. Break ties by normalized path using byCodeUnit.
5. **Select context.** Keep rank and pack selection separate. Prioritize direct
   evidence, then choose items by marginal coverage of anchors and useful roles
   per rendered byte. Penalize redundant evidence and prefer compact entries
   when they cover the same role. Use the existing budget mechanism and check
   final serialized bytes, including headings and provenance. Report omissions
   from candidate caps separately from omissions due to the pack budget.

## Data structures and indexing

- Assign integer file IDs in normalized path order. Store symbols by module,
  declaration kind, qualified name, exported alias and source line. Keep
  postings for exact identifiers, split identifier components and route
  segments. Store document frequency and cap common-term postings.
- Store sparse forward and reverse adjacency lists. Each edge has a relation
  type, evidence path and line, and observed or inferred status. A static
  import is observed at its source. A target mapping derived from conventions
  is inferred. Require a unique in-snapshot target for traversal.
- Start with static JS and TS imports, named re-exports and import-bound
  symbol references. Use package entry metadata and statically declared
  aliases where supported. Resolve React JSX references through local bindings,
  including aliases and namespace members. Treat convention-based page and
  route mappings as inferred. Skip ambiguous resolution and dynamic imports
  whose targets cannot be determined from literals.
- For Laravel, resolve literal route declarations to controller methods using
  imports and namespace mappings from composer.json. Connect controller
  service usages through resolved type references and literal view names to
  existing Blade paths. Connect literal Blade includes where resolvable.
  Capture group prefixes only when statically known. Leave container bindings,
  macros and dynamic routes unresolved when evidence is insufficient.
- Expand identifiers with aliases, split spellings, route segments or
  referenced names derived from the anchor's own evidence. Accept an expansion
  only when it resolves to an indexed entity. Keep the original terms and
  cap expansions per anchor. Avoid global synonym lists and repository names
  hard-coded into scoring.
- Start with up to 24 graph seeds, 8 edges per node and relation, two hops,
  and 64 total candidates with reserved lexical and graph capacity. A second
  hop requires a resolved symbol or route chain through a non-hub node.
  Visit nodes in stable evidence order, de-duplicate cycles and apply a global
  traversal budget in addition to per-node caps. Tune these provisional
  limits on development repositories only. Report budget exhaustion.

## Security boundaries

Read through the existing reader and use only indexed in-root targets.
Preserve ignore, sensitive-file, byte and symlink rules. Parse static text
without importing modules, evaluating code, invoking frameworks or running
commands from scanned projects. Treat configuration and comments as data.
Prefer bounded token scanning and add adversarial coverage in security.test.js
for regexes applied to source. Cap token lengths, parser work, edges and
postings. Skip malformed or unsupported syntax deterministically and expose
coverage diagnostics. Pass repository-derived evidence through redact() and
neutralize() before presentation. Avoid indexing or emitting arbitrary
literal contents. Keep identifiers and edges local and ephemeral.

## Performance trade-offs

Fuse extraction with the existing read pass so graph construction avoids a
second I/O sweep. With B bytes scanned, P retained postings and E retained
edges, extraction should be linear in B and index storage proportional to
files, P and E. Stable sorting and resolution add CPU work. Candidate budgets
bound query-time graph work, while high-degree repositories can still make
index construction the dominant memory cost. Measure index build time and
peak RSS separately from warm query and pack assembly. Deterministic caps
may reduce coverage on large repositories. Report that coverage alongside
latency. Preserve the dependency-free runtime and avoid persistent manifests.

## Evaluation protocol

- Recruit public repositories with ownership independent of the ContextAnvil
  developer. Pin repository and task snapshot SHAs. Stratify by ecosystem,
  size and task type, including Laravel, React, other stacks and docs/config.
  Split by repository and related project family into development and sealed
  holdout sets. Target at least 20 holdout repositories and 200 tasks.
  Determine whether to increase this target using development-set variance
  before sealing the holdout. Report the achieved sample and exclusions.
- Use issue text or pre-fix descriptions available at the snapshot as primary
  queries. Keep terse subjects as a separate diagnostic slice. Exclude added
  files from retrieval denominators and report them separately. Freeze a common
  eligibility set for engine comparisons and also report all existing relevant
  files, including unsupported types. Report tasks with no eligible labels.
- Have two reviewers independently inspect the snapshot and task evidence
  without ranker output. Label essential, useful and incidental files with
  rationale, including relevant unchanged files. Use patches as one evidence
  source and separate the changed-file proxy from adjudicated relevance.
  Record raw agreement, weighted agreement by grade and adjudication rate.
  Record unresolved labels and measure sensitivity to excluding or including
  them. Freeze queries, snapshots, labels and rubric by digest before any
  ranking evaluation. Keep a sealed holdout out of tuning and treat any
  post-run label corrections as a new benchmark version.
- Compare pinned Phase 1.2 and v0.1.0, the lexical-only v2 path, full v2 and
  development ablations for reverse links, symbol and route edges, expansion
  and budget selection. Apply equal candidate caps, read limits and pack
  budgets where comparable. Keep extraction and scoring blind to gold labels.
- **Retrieval:** report eligible and all-label candidate recall at 16, 32
  and 64 and the fraction never proposed. **Ranking:** report P@1, MRR,
  R-precision and Recall@5/8 with the same eligible denominator, and nDCG@8
  for graded labels. **Pack usefulness:** report essential-file and role
  coverage, irrelevant bytes and blinded reviewer scores for whether the
  pack provides enough cited evidence to locate and plan the change at
  fixed 4, 8 and 16 KiB budgets. Randomize pack presentation order.
- **Cost:** interleave runs across engines on identical snapshots. Record
  cold process scan/index/compile latency, warm query latency, peak RSS,
  bytes read and coverage, with OS, Node and cache conditions. Report medians
  and p95 by repository size. Use a documented cold-cache procedure or label
  the result as fresh-process with uncontrolled OS cache.
- Report paired changes with 95% intervals from a seeded bootstrap that
  resamples repositories and retains paired tasks within them. Report
  repository-macro averages and per-stack slices. Preregister primary
  endpoints and use simultaneous intervals for the co-primary endpoints.
  When an interval includes zero, report the estimate as inconclusive for
  improvement. Record benchmark inputs, engine SHAs and raw outputs.

## Implementation phases

1. Freeze protocol and datasets. Instrument Phase 1.2 candidate, rank and
   pack outputs and collect baseline costs.
2. Implement sparse static import, reverse and symbol indexing behind an
   experimental compiler option. Verify provenance, resolution and caps.
3. Add bounded route, view and component edges, then query expansion and
   reranking. Measure each change on development tasks before freezing code.
4. Add budget-aware selection and evaluate the frozen configuration once
   on holdout. Promote only after the gates below are met. Keep failed
   holdout results and use fresh holdout repositories after further tuning.

## Acceptance criteria

These are proposed release thresholds. Preregister them before measuring
the holdout.

- At 64 candidates, improve eligible candidate recall by at least 10
  percentage points over Phase 1.2. Improve essential-file coverage in 8 KiB
  packs by at least 5 points. Both paired confidence intervals must exclude
  zero in the favorable direction.
- For MRR and Recall@8, require the paired lower confidence bound to exceed
  a non-inferiority margin of -0.03. Report P@1 and R-precision and inspect
  stack-level regressions before promotion.
- Require blinded pack usefulness to have a paired lower bound above
  -0.05 on a normalized 0-to-1 scale. Every pack must respect its budget and
  retain provenance for included evidence.
- Require weighted pre-adjudication label agreement of at least 0.70.
  Review low-agreement strata before freezing and publish the adjudication
  and sensitivity results.
- On the same machine and corpus, cap p95 fresh-process latency at 1.25x
  baseline and peak RSS at 1.5x baseline on the 5,000-file fixture and
  preregistered real-repository size bands. Report warm query p95 separately.
- Verify byte-identical outputs across processes and the CI matrix, including
  partial coverage and ambiguous imports. Exercise hostile input, traversal
  caps, symlink containment and secret redaction. No scanned-repository
  execution or writes.
