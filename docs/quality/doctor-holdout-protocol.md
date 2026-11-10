# Independent Doctor holdout protocol

The [input reservation](../../bench/doctor/holdout/inputs.json) contains
10 pinned Git trees and 24 instruction paths. It is separate from the disclosed
historical corpus and synthetic development fixtures. Verify its documented
digest before review. No candidate output exists for this holdout.

## 1. Prepare the review without running Doctor

Assign a custodian and two reviewers who did not tune the candidate. The custodian
verifies the pinned Git trees, modes and instruction blobs, checks any applicable
license terms, and creates isolated read-only snapshots. Use raw Git tree data
so source export exclusions do not change the sample. Disable hooks and filters,
omit submodule downloads, and record any unavailable files. Do not run repository
code, setup commands, or an analyzer against these snapshots.

Give each reviewer the same rubric, manifests and source snapshots, without
the other reviewer's labels or candidate predictions. Reviewers independently
enumerate positive and negative opportunities. For each, record the repository,
commit, category, supported finding ID or unsupported capability, claim, scope,
reference target, expected anchors, expected severity, next action and rationale.
Use the [original rubric](../../bench/doctor/README.md#labeling-rubric) for true
issues, harmless examples, ambiguous claims, unsupported cases and non-issues.
Record lifecycle or filename advisories separately from confirmed security issues.
Do not copy credential values into labels or notes.

## 2. Adjudicate and seal the evaluation

Preserve both independent label files. The custodian reconciles differing scopes,
evidence lines and expected severities with the reviewers. Record both original
decisions and the adjudication rationale. Keep genuinely unresolved cases
ambiguous. Each supported positive and negative has an explicit matching rule.
Do not invent negatives simply by counting files or untriggered detector IDs.

Before any candidate run, lock and record:

- Exact candidate Git commit and Skill engine tree hash.
- Snapshot hashes, both independent label digests and adjudicated label digest.
- Expected sample counts by category, severity and ecosystem.
- Matching and duplicate rules, treatment of ambiguous and unsupported cases,
  and the protocol for reviewing unmatched output.
- Required sample coverage and pre-agreed release gates. For example, choose
  minimum precision and recall with uncertainty bounds for relevant categories,
  and a zero-tolerance gate for confirmed credential leaks in tool output.

Expand insufficient categories before the candidate runs, using fresh pinned
inputs selected without predictions. If independent reviewers or adequate
coverage are unavailable, record the blocker and keep the holdout sealed.
Keep ground truth inaccessible to implementation work until the candidate is locked.

## 3. Run the locked candidate once

Run `doctor <snapshot> --json --fail-on never` on each read-only snapshot,
without changing default detection settings. Record OS, Node version, command
line, input hashes, exit status and raw reports. Keep output outside the
snapshots. Do not tune or relabel after seeing the outputs. Repeat only to
diagnose a documented environmental failure or verify determinism.

Score the frozen determinate cases by category and ecosystem. Report TP, FP,
FN, TN, precision, recall, F1, FPR, evidence and severity agreement, actionability,
sample counts and uncertainty. Distinguish the denominators for detected issues
and review cues. Audit unmatched findings individually and report confirmed
false positives, ambiguity, unsupported cases and duplicates in a separate
table. Include the original outputs and the full denominator whenever reporting
any broader precision estimate.

Compare the results with the preregistered gates. Passing CI is a separate
engineering requirement. If the candidate fails a gate, develop fixes on
separate inputs and reserve a new blind holdout before measuring release accuracy
again. The disclosed holdout can still serve as regression evidence.
