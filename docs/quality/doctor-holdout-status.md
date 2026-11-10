# Doctor independent holdout: status

**The holdout is prepared and sealed. It has not been executed, and it cannot be until independent human
review exists.** Nothing here is release evidence about Doctor's accuracy. It records what is ready, what
was verified, and what is still missing. No beta or v1.0 is released.

## Candidate

| Item | Value |
| --- | --- |
| Pull request | [PR 19](https://github.com/AVL05/contextanvil/pull/19), **open draft, not merged** at the time of writing |
| Candidate commit (PR head) | `3d0d5801717102ff4eeaab14f488b683ca3bb639` |
| `src` tree | `84f9794b9d0bab99c737e277330628c44511ee9a` |
| `bin` tree | `8e30cc2c2190d17ae52967125b68fd5aa9724f9e` |
| Skill tree (`skills/contextanvil`) | `c0a5425e1e02070e6b094376469a36e064383045` |
| `package.json` blob | `e38e833f4de601b99ac71653323f67a4afb96f30` |
| Base | `main` is an ancestor of the head. No `main` commit contains this candidate yet |

Because PR 19 is not merged, there is no final `main` commit to record. If it is squash-merged, the squash
commit has a new id, so the lock must record the **tree ids above** and verify that they are unchanged.
The evaluation infrastructure adds files under `bench/`, `docs/` and `test/` only. It changes none of the
four identities above.

Verified at the candidate on Windows 11 with Node 24.22.2: `npm test` ran 166 tests with 163 passes, three
platform skips and no failures. The first run in this session had one transient failure in
`test/manifest.test.js` (`MANIFEST_STORAGE`, "a file is busy or access was denied"), which did not recur when the
file and the full suite were run again, so it is likely a Windows file-lock flake and has not been investigated
further. `npm run skill:check` reported that the Skill engine is in sync with `src/`. All 11 CI check runs on
the PR head completed successfully.

## Holdout integrity

| Check | Result |
| --- | --- |
| LF-normalised SHA-256 of [`inputs.json`](../../bench/doctor/holdout/inputs.json) | `0b7c67c82d2509eb8ae779d5576b710dedca4160d39dcf7676936ea498e2147e`, equal to the documented digest |
| File unchanged by this work | yes. Its Git blob (`9ca34017393404adddb995f3deccf3295d29916e`) is identical to the committed one. On this Windows checkout the working file has CRLF line endings, so its raw SHA-256 differs. The documented LF-normalised method matches |
| Counts | 10 repositories, 24 instruction paths (35 reserved paths including licence files) |
| Overlap with the disclosed historical corpus or fixtures | none |
| Doctor output, labels or predictions for these repositories anywhere in the repository | none (checked by `verify-inputs.mjs`) |
| Commit existence | all 10 commits exist and are public |
| Reserved path identities | all 35 paths match the recorded mode and blob id at the pinned commit |
| Submodules | none. Symbolic links per repository: 1, 0, 3, 0, 1, 0, 4, 6, 2, 2 |
| Listing truncation | none for any repository |

Checks used the host's metadata API for repository, commit, tree and path identities. No file contents were
read, Doctor was not run, and no source was inspected.

Findings from the verification, none of which change the sealed reservation:

1. **The reservation's `tree` field repeats the commit id for all 10 entries.** A tree id can never equal a
   commit id, so the field is a mislabeled alias. Editing it would change the sealed digest. The real tree ids
   are recorded in [`identities.json`](../../bench/doctor/holdout/identities.json), an addendum that
   `verify-inputs.mjs` checks against the reservation.
2. **One repository has been renamed or transferred.** The reserved `facebook/react` now resolves to
   `react/react`. The commit identity still holds. This is recorded in `identities.json` as `currentFullName`.
3. **One repository reports `NOASSERTION` as its license.** Its terms need a manual read before reviewers
   receive its snapshot. Snapshots are for review use and are never redistributed or committed.
4. **Default scan limits.** The recursive tree listings of several repositories (two exceed 25,000 entries,
   counting blobs and trees) may exceed Doctor's default 20,000-file index limit. If so, the
   candidate will emit `file-limit` findings and make absence claims on an incomplete index. The protocol
   keeps default settings, so reviewers must label those `scan` opportunities and the effect on `stale` claims.
   The exact blob counts come from the listings the custodian will produce.

## What is ready

| Deliverable | Where |
| --- | --- |
| Reviewer instructions and rubric | [`REVIEWER-INSTRUCTIONS.md`](../../bench/doctor/holdout/REVIEWER-INSTRUCTIONS.md), [`rubric.md`](../../bench/doctor/holdout/rubric.md), [`claims.tsv`](../../bench/doctor/holdout/claims.tsv) |
| Labeling, adjudication, coverage and audit templates | [`templates/`](../../bench/doctor/holdout/templates/) |
| Reproducible custodian tools | [`tools/`](../../bench/doctor/holdout/tools/): verify, materialize, package, validate, lock, execute, evaluate |
| Release gates, with derivations | [`doctor-release-gates.md`](doctor-release-gates.md), [`gates.json`](../../bench/doctor/holdout/gates.json) |
| Procedure | [`RUNBOOK.md`](../../bench/doctor/holdout/RUNBOOK.md) and the [protocol](doctor-holdout-protocol.md) |
| Tool tests, on synthetic repositories only | `test/holdout-tools.test.js`, `test/holdout-pipeline.test.js` |

Read-only snapshots are reproducible but **have not been materialized**. Materializing and reading them is
custodian and reviewer work, and the snapshots cannot be redistributed. The independence rules below also
mean that the agent that wrote the tools must not label or inspect them.

## Why the holdout stays unexecuted

- **No independent labels exist.** Two reviewers who did not tune the candidate must label the opportunities
  independently. A second pass by the same agent, or by any language model, is not independent review. This
  work was done by an AI coding agent and deliberately produced no label.
- **The gates are proposed, not ratified.** The maintainers must ratify them before the lock. The lock tool
  refuses unratified gates.
- **The candidate is not final.** PR 19 is an open draft awaiting human review.
- **Coverage is unknown.** Whether the ten repositories supply enough positives and negatives per category
  (at least 14 defect positives and 29 negatives overall, 5 and 29 per gated category) can only be learned
  from the reviewers' labels. If it is insufficient, fresh pinned inputs must be reserved before any candidate
  run, as the protocol requires.

## Remaining prerequisites

1. Merge or otherwise finalise PR 19 after human review. Record the final commit and the four tree ids above.
2. Maintainers review and ratify `gates.json`, or adjust it, in a reviewed commit before the lock.
3. Name a custodian and two independent human reviewers. Record conflicts and tool use in the attestations.
4. Check the license terms for review use, especially for the `NOASSERTION` repository.
5. Materialize snapshots on Linux or macOS with the runbook, build the two packages, and collect independent
   submissions.
6. Adjudicate, lock, and run the candidate once. Audit unmatched findings. Report every gate, including
   failures and `unvalidated` categories.

A failed or unvalidated gate means no accuracy claim for that part of Doctor. It never means relabeling,
re-running or tuning against this holdout.
