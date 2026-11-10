# Reserved Doctor holdout inputs

The [input reservation](inputs.json) pins 10 public Git trees and 24 instruction
paths. The SHA-256 of the UTF-8 manifest with LF line endings is
`0b7c67c82d2509eb8ae779d5576b710dedca4160d39dcf7676936ea498e2147e`.
It records Git commit, tree and blob identities, file modes (including symlinks)
and available license metadata. Inspect the pinned license files for scope and
redistribution terms. No repository contents are distributed here.

Selection used public tree metadata and ecosystem coverage. The inputs cover
JavaScript, TypeScript, React, Next.js, PHP, Laravel, Python, Go and Rust. They
do not overlap the historical repositories or development fixtures. No Doctor
output was generated for these inputs. They remain reserved until independent
labels are available. This is an input reservation, with no completed independent
evaluation or sealed ground truth.

## Blind review protocol

1. Materialize each pinned Git tree in a fresh isolated directory with symlink
   modes preserved. Verify the commit, tree and instruction blobs against the
   reservation. Prefer Git tree materialization so that archive export exclusions
   do not change scope. Disable hooks and filters, omit submodule downloads and
   never run code in the repository. Record any unsupported file type or missing
   submodule, and make the evaluation snapshot read-only.
2. Two reviewers independently label issues and explicit negative opportunities
   from source. Use the [rubric](../README.md#labeling-rubric). Record the owning
   manifest or path when relevant, the expected anchor and severity, and whether
   a concrete next action is justified. Mark unsupported and ambiguous cases
   explicitly. Preserve initial reviews and document adjudication.
3. Freeze the adjudicated labels and input digests before running the candidate.
   Keep the labels separate from the development branch until the engine revision
   is locked. If a category has too few positives or negatives, record that gap
   and reserve additional inputs before seeing Doctor output.
4. Run Doctor with default detection settings and `--fail-on never --json`.
   Preserve every result. Report TP, FP, FN and TN by category and ecosystem,
   evidence and severity agreement, actionability, and sample sizes. Report
   unmatched findings separately and distinguish sample uncertainty from
   population claims. Once inspected, the holdout is disclosed and cannot be
   reused for blind validation after tuning.

## Evaluation infrastructure

The reservation above is unchanged. The rest of this directory prepares the independent evaluation without
running it. Start with the [status record](../../../docs/quality/doctor-holdout-status.md).

| File | Purpose |
| --- | --- |
| [`RUNBOOK.md`](RUNBOOK.md) | The reproducible custodian procedure, from integrity check to report |
| [`REVIEWER-INSTRUCTIONS.md`](REVIEWER-INSTRUCTIONS.md), [`rubric.md`](rubric.md), [`claims.tsv`](claims.tsv) | What each independent reviewer receives |
| [`templates/`](templates/) | Blank label, adjudication, coverage, audit and attestation files |
| [`gates.json`](gates.json) | Pre-registered, machine-readable release gates ([derivations](../../../docs/quality/doctor-release-gates.md)) |
| [`identities.json`](identities.json) | Real Git tree ids, which the reservation's `tree` field does not hold (it repeats the commit id) |
| [`tools/`](tools/) | Verify, materialize, package, validate, lock, execute and evaluate. Tested on synthetic repositories only |

No snapshot, label, prediction or report is stored here. `tools/verify-inputs.mjs` fails if one appears.
