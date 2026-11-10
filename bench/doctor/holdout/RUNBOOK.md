# Holdout runbook

The end-to-end, reproducible procedure for the independent Doctor evaluation. It implements the
[protocol](../../../docs/quality/doctor-holdout-protocol.md) and the
[release gates](../../../docs/quality/doctor-release-gates.md). **Do not start step 4 until every
prerequisite in step 0 is satisfied.** Steps 1 to 3 never execute Doctor.

All commands run from the repository root with Node 22 or later. `WS` is a workspace directory outside the
repository, never committed. Tools live in [`tools/`](tools/).

## Roles

| Role | Who | Must not |
| --- | --- | --- |
| Custodian | One person who did not tune the candidate | Label, or show either reviewer anything from the other |
| Reviewers R1 and R2 | Two independent humans | Run any analyzer, talk to each other, or have seen Doctor output on these repositories |
| Maintainers | Ratify the gates | Change the engine, labels, rules or gates after the lock |

A language-model pass, or two passes by one agent, is not an independent review. If two independent human
reviewers are unavailable, stop at step 0, record the blocker in the
[status record](../../../docs/quality/doctor-holdout-status.md) and leave the holdout unexecuted.

## 0. Prerequisites

1. The candidate engine is final: PR 19 merged, or a named commit the maintainers accept. Record it.
2. The maintainers ratified [`gates.json`](gates.json) (`"status": "ratified"`) in a reviewed commit.
3. Two independent human reviewers and one custodian are named, with conflicts disclosed.
4. License terms for every reserved repository were checked for review-only use. One entry reports
   `NOASSERTION`, so its terms need a manual read. Snapshots are never redistributed or committed.
5. A Linux or macOS machine (symbolic links) with Git 2.32 or later and network access to the host.

```bash
node bench/doctor/holdout/tools/verify-inputs.mjs
```

Must print `Holdout reservation intact` and exit 0.

## 1. Materialize the snapshots (custodian)

```bash
node bench/doctor/holdout/tools/materialize.mjs --out "$WS/materialized"
```

Each pinned commit is fetched through Git, the real tree id is compared with
[`identities.json`](identities.json), the reserved path blobs are compared with the reservation, and
files are written from raw blob bytes: no hook, filter, end-of-line conversion or archive export rule applies.
Snapshots are read-only. Submodules are not downloaded and are recorded as unavailable. Nothing is run.

## 2. Build the two review packages (custodian)

```bash
node bench/doctor/holdout/tools/package.mjs --workspace "$WS" --materialized "$WS/materialized" --reviewer R1
node bench/doctor/holdout/tools/package.mjs --workspace "$WS" --materialized "$WS/materialized" --reviewer R2
```

Both packages carry the same `COMMON-DIGEST`. Send each reviewer only their own `packages/<id>` and the
read-only snapshots. Reviewers return `labels.tsv`, `coverage-log.tsv` and `attestation.md` to
`submissions/<id>/` through the custodian. Never forward one reviewer's files to the other.

## 3. Validate, adjudicate and lock (custodian)

Validate each submission and return structural errors only:

```bash
node bench/doctor/holdout/tools/check-labels.mjs "$WS/submissions/R1/labels.tsv" \
  --listings "$WS/materialized/listings" --coverage "$WS/submissions/R1/coverage-log.tsv" --final
```

Adjudicate into `adjudication/adjudicated.tsv` (columns in [`templates/adjudication.tsv`](templates/adjudication.tsv)).
Keep both original decisions on every row (`r1_*`, `r2_*`), record why they differed, and keep unresolved
cases `ambiguous`. Every reviewer opportunity must appear in some adjudicated row. Give each supported
opportunity a distinct matching rule (`anchor_path`, `anchor_line`, `match_key`).

If a category lacks the minimum positives or negatives, reserve fresh pinned inputs **now**, selected without
predictions, and repeat steps 1 to 3 for them. Then lock:

```bash
node bench/doctor/holdout/tools/seal.mjs --workspace "$WS"
```

The lock checks the reservation, both submissions, the adjudication and the coverage minimums, and records
the candidate commit, the `src`, `bin`, Skill and `package.json` tree ids, and a digest for every file the
evaluation depends on. A category below its minimum blocks the lock, unless you add
`--allow-unvalidated-categories`, which records it as unvalidated and leaves it without an accuracy claim.

## 4. Run the locked candidate once (custodian)

```bash
node bench/doctor/holdout/tools/execute.mjs --workspace "$WS"
```

It re-verifies the lock, checks each snapshot against its pinned listing, runs
`doctor <snapshot> --json --fail-on never` and a repeat for determinism, checks every output byte, checks the
snapshot again, and writes `runs/run-record.json` (OS, Node, command, exit status, hashes of outputs). A
second run is refused. Repeat only to diagnose a documented environmental failure, and say so in the report.

For the runtime gate, with the previously published candidate checked out beside the locked one:

```bash
node bench/doctor/profile.js BASELINE_ENGINE CANDIDATE_ENGINE "$WS"/materialized/snapshots/* > "$WS/runs/profile.json"
```

## 5. Audit unmatched findings, then score

```bash
node bench/doctor/holdout/tools/evaluate.mjs --workspace "$WS" --make-audit
```

Two reviewers label `audit/audit-queue.tsv` independently with the frozen rubric (columns in
[`templates/audit-labels.tsv`](templates/audit-labels.tsv)). The queue hides the engine's severity and mixes in
control items from the locked labels. The custodian adjudicates into `audit/audit-adjudicated.tsv`. Any
credential suspect in `run-record.json` is reviewed by the custodian and recorded in `runs/leak-review.json`
(`{"<suspect>": "benign"}`; anything else counts as a leak). Then:

```bash
node bench/doctor/holdout/tools/evaluate.mjs --workspace "$WS" --profile "$WS/runs/profile.json"
```

`result/result.json` holds every gate with its counts, bound and limit, the per-opportunity outcomes, the
unmatched findings with their audit verdicts, duplicates and the reviewer agreement on controls.

## 6. Report

Publish the report only after the custodian and maintainers review it. Include, unedited: the lock, the
run record, the full gate table with denominators, the audit denominator, every confirmed false positive,
ambiguous and unsupported counts, reviewer agreement and its limits, and any deviation from this runbook.
If a gate fails, say so, fix on separate inputs, and reserve a new sealed holdout. Do not relabel or
re-run this one for a release claim. Once inspected, it is disclosed regression evidence only.

## Reproducing the checks without any holdout material

`node --test test/holdout-tools.test.js` exercises every tool above on synthetic repositories created in
temporary directories. It never touches the reserved repositories.
