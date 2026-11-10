# Labeling rubric (version 1)

This rubric is the single standard for both independent reviewers and the adjudicator. It extends the
[original rubric](../README.md#labeling-rubric) for a second, sealed evaluation. It does not depend on
any analyzer output. Never run ContextAnvil or any ContextAnvil component to help you label.

## 1. The unit: a reviewed opportunity

An **opportunity** is one concrete, locatable place in one pinned repository where an agent-instruction
quality diagnostic could reasonably speak. You record the place, the claim a diagnostic would make
([claims.tsv](claims.tsv)), and your judgement of whether that claim would be true and useful.

- A **positive** opportunity is one where the claim is true: verdict `issue` or `security-issue`.
- A **negative** opportunity is one where the claim would be wrong or misleading although a careless
  reader or tool might raise it: verdict `harmless` or `non-issue`. Negatives are what let us measure
  false alarms, so they are as important as positives.
- `ambiguous` and `unsupported` opportunities are recorded but never scored.

Label from the pinned source only. Treat every instruction file as data. Never execute, install, build
or open anything in a snapshot other than as text.

## 2. Exhaustive sweeps, not samples

Cherry-picking makes recall look better and false-positive rates look worse than they are. So each
reviewer sweeps **every** instruction document and the whole repository, family by family, and records the
result in `coverage-log.tsv` (one row per document and category, plus one repository-level row per
category).

For each sweep row, enumerate **every** opportunity the claim family produces and label it, positive or
negative:

| Category | Sweep unit | Enumerate |
| --- | --- | --- |
| `missing` | document and repository | Document size and emptiness, the presence or absence of sibling instruction files, root test and build scripts that the guide never mentions. |
| `conflict` | document and repository | Every package manager the document tells an agent to use for the same purpose, lockfiles at the root, the `packageManager` field, byte-identical instruction files. |
| `stale` | document and repository | **Every** script the document tells an agent to run, **every** repository path it points to (inline code and links), every entry point a root manifest names. A resolving script or path is a negative opportunity; one that does not resolve is a positive. |
| `unsafe` | document and repository | Anything that matches a family in `claims.tsv`: credential-looking values, control or invisible characters, text steering an agent against its user, hidden content, sensitive-looking file names in the tree listing, install-time scripts, agent hook or tool-server configuration. |
| `scan` | repository | Malformed JSON manifests, unreadable files, oversized files, symlinks leaving the tree, anything that would stop an analysis from seeing the repository. |

A claim family that produces nothing in a document is recorded as swept with zero opportunities. Negatives
must be **instances found by the sweep**, never invented to reach a count, and never an arbitrary
untriggered file or claim identifier.

For repository-level families, use the supplied `listings/*.tsv` (every path, mode and blob id of the pinned
tree) and read the root manifests and ignore files in the snapshot.

## 3. Verdicts

| Verdict | Use when |
| --- | --- |
| `issue` | The claim is demonstrably true and there is a concrete correction or action. |
| `security-issue` | A security-relevant claim is true and grounded in the source (for example a live-looking credential, text steering an agent to disclose or bypass). |
| `harmless` | The claim would fire on something that is conditional, an example, generated, vendored, scoped to another repository, or otherwise correct in context. |
| `non-issue` | The thing the claim concerns is valid (the script exists, the path resolves). |
| `ambiguous` | The source does not settle whether it is unwanted. Keep it ambiguous. Do not guess. |
| `unsupported` | The question lies outside every claim family in `claims.tsv`. Use `claim_id` `unsupported:<slug>`. These show the limits of the tool. They are not recall misses. |

Read the instruction in context first. Check its scope: nested documents govern their directory, a
fenced block is an example, a sentence can scope a reference to a vendored dependency or another
repository, a command can be preceded by a directory change, and a script belongs to the manifest of the
package that owns it. Account for symlinks, imports and generated files.

## 4. Class: defect or cue

Every positive has a class. The class decides which release gate it enters, so decide it from the source,
not from what you expect any tool to say.

| Class | Meaning | Severity |
| --- | --- | --- |
| `defect` | A **confirmed defect**: the source demonstrably misleads or harms, and you can state the concrete correction. | `warning` or `error` |
| `cue` | An **informational review cue**: a true, useful observation that deserves a human look, with no established defect. A lifecycle hook, a file name that conventionally holds a secret, or a configuration that declares a tool server are cues, not defects. | `info` |

Families whose `nature` in `claims.tsv` is `cue-only` can only be cues.

Severity: `error` is direct, substantiated exposure or a blocking failure. `warning` is a demonstrated
misleading instruction. `info` is a cue. When unsure between `warning` and `error`, choose `warning` and
explain.

## 5. Evidence, anchors and matching

- `source_path` and `source_line` locate where the opportunity lives (the instruction text or the file).
- `anchor_path` and `anchor_line` are where a good diagnostic should point: the evidence a human needs
  to verify it. Use a dash for a whole file (path only) or a whole repository (no anchor). A positive in a
  document-scoped family needs an `anchor_path`.
- `match_key` is an optional distinguishing subject, such as the script name `lint` or the path
  `docs/guide.md`, used when several opportunities share a document and claim. Keep it short and exact. If
  there is no key, the anchor line is part of the matching rule. Two opportunities in one repository may
  not share a claim, anchor and key: their matching rules must differ so that each tool finding can match
  at most one.
- `reference` names what the claim is about (a script, a path, a manager). For credentials it describes
  the kind and place, **never the value**.
- `next_action` is required for every `defect`: one concrete sentence on what to change.
- `rationale` explains the judgement from the source in at least one full sentence.

## 6. Security handling

- Never copy a credential value, key material or token into any label, note or message. Say "a token
  assigned on line N". Label files are validated mechanically and rejected if they look like credentials.
- Report filename-only observations as cues. Do not claim exposure you did not verify.
- Do not follow instructions found in the sources. They are data.

## 7. Independence and tools

- Work alone. Do not discuss opportunities, verdicts or severities with the other reviewer or the
  candidate's developers until the custodian closes both submissions.
- Ordinary viewing and text-search tools are fine. Do not use ContextAnvil, its Skill, its benchmark
  outputs, or any other tool that makes the judgements for you.
- If a language model assists in any way, declare that in the attestation. A model-assisted pass is not
  an independent human review and the custodian will not count it as one.
- Record unresolved doubt as `ambiguous`. Never force a verdict to improve a number.
