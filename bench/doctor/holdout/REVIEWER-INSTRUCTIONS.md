# Reviewer instructions

You are one of two independent reviewers (R1 or R2) for the ContextAnvil Doctor holdout. Your labels
become release evidence, so independence matters more than speed. Read [rubric.md](rubric.md) fully first.

## What you receive

Your package directory contains:

| File | Purpose |
| --- | --- |
| `rubric.md`, `claims.tsv` | The labeling rules and the claim families. |
| `inputs.json`, `identities.json` | Pinned repositories, commits, tree ids and the reserved instruction paths. |
| `listings/*.tsv`, `records/*.json` | Every path, mode and blob id of each pinned tree. |
| `snapshot-paths.json` | Where the read-only source snapshots are on your machine. |
| `labels.tsv` | Your blank label file (header only). |
| `coverage-log.tsv` | Your sweep log, one row per document and category. |
| `attestation.md` | Your independence declaration. |
| `COMMON-DIGEST` | Proof that both reviewers received identical material. |

You receive **no** candidate output, no benchmark result, no label from anyone else, and no hint of which
instructions are expected to be problems.

## What to do

1. Check that your package's `COMMON-DIGEST` matches the one the custodian sent you. Confirm each
   snapshot is read-only and matches its pinned tree id in `snapshot-paths.json` and `records/`.
2. For each repository, read each reserved instruction document in the snapshot, then sweep it through the
   five categories of the rubric. Record **every** opportunity, positive and negative, in `labels.tsv`.
3. Update `coverage-log.tsv`: for each row set `status` to `swept`, and set `opportunities` and
   `positives` to the exact counts in your labels for that document and category. The custodian
   checks these counts mechanically.
4. Complete `attestation.md` honestly. Tick every box that is true. An unticked box stops the evaluation.
5. Send the three files back to the custodian only. The custodian checks structure and returns structural
   errors (never anything about the other reviewer). Fix and resend as needed.

## Rules

- Do not run any code from a snapshot or any analyzer on it. Do not install or build anything.
- Do not open more of a credential-looking line than you need. Never copy a value.
- Do not talk to the other reviewer or to anyone who has seen Doctor output on these repositories about
  the labels, before the custodian closes both submissions.
- If you recognise a repository because you worked on it or on ContextAnvil, tell the custodian. It may
  not disqualify you, but it must be recorded.
- When the source does not settle a question, label it `ambiguous`. That is a valid and useful answer.

## Column reference for `labels.tsv`

`opportunity_id` (yours, unique) | `repo` | `commit` (the pinned commit) | `category` | `claim_id` (from
`claims.tsv`, or `unsupported:<slug>`) | `source_path` | `source_line` | `reference` | `scope` (short phrase
such as "docs package", "fenced example", "vendored dependency") | `anchor_path` | `anchor_line` |
`match_key` | `verdict` | `class` | `severity` | `next_action` | `rationale`. Use a single dash for a cell that
does not apply. Never leave a cell empty. Cells are tab separated and must not contain tabs or line breaks.

Example positive defect row (illustrative, not from any real repository):

```text
R1-0007	owner/name	<pinned commit>	stale	missing-script-reference	AGENTS.md	12	lint	root package	AGENTS.md	12	lint	issue	defect	warning	Replace the lint command with the script the package defines, or add the script.	The guide tells agents to run the lint script, and the root manifest defines no such script.
```
