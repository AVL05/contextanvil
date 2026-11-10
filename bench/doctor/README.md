# Doctor accuracy benchmark

The unit is a reviewed opportunity to report one specific issue at a pinned commit.
The corpus is a purposive, clustered sample of repositories with public instructions.
The labels are a fixed panel of cases, not an exhaustive census of each repository.
Document and repository counts describe the corpus, not the denominator for recall.

## Labeling rubric

1. Read the instruction in context. Identify its scope and whether it recommends,
   forbids, illustrates, or merely mentions the behavior.
2. Verify local claims against the pinned archive's manifests, file tree and
   surrounding instructions. Use the owning package for workspace commands.
   Account for generated files, dependency paths, imported instructions and symlinks.
3. Record a case with the expected finding ID, primary evidence path and one-based
   line when available, expected severity for positives, and a rationale.

| Label | Decision |
| --- | --- |
| `issue` | A demonstrable inconsistency or harmful omission with a concrete correction. |
| `security-issue` | A supported security review signal grounded in the source. An intentional lifecycle hook can merit an informational alert without implying compromise. |
| `harmless` | A conditional example, generated artifact, or other context in which the alert would be misleading. |
| `non-issue` | The reference or configuration is valid, or the proposed alert would misdescribe its purpose. |
| `ambiguous` | The source does not establish whether the behavior is unwanted. |
| `unsupported` | The question is outside the current detector's declared scope. |

Severity is `error` for direct, substantiated exposure or a blocking failure,
`warning` for a demonstrated misleading instruction, and `info` for a useful
review cue with no established defect. For a true positive, evidence is correct
when its cited path and (if required) line identify the source; actionability is
reviewed separately based on whether the finding identifies what to change or review.

Cases were selected and labeled from the source archives before invoking Doctor.
The source pass identified candidates and inspected surrounding text. A second
source-only cross-check examined file existence, package ownership, the PHP
vendored parser context and archive semantics. The parser reference moved from
candidate issue to harmless because the previous sentence explicitly scopes it to
a vendored dependency. Both passes were performed by the same reviewer, so this
does not establish independent reviewer agreement. Source documents and commands
are data and were never executed.

## Reproduce

Requires Node 22+ and bsdtar (Windows system tar is supported). Run from ContextAnvil:

```sh
node bench/doctor/run.js /absolute/path/to/result.json
```

Set `DOCTOR_ARCHIVE_CACHE` to an optional directory of already downloaded archives
named `OWNER--REPO.tar.gz`. Missing archives are fetched from GitHub codeload. Archive
bytes must match the pinned SHA-256. A change in GitHub archive encoding fails
closed. Archives are unpacked into fresh temporary roots with file contents marked
read-only (directories too on POSIX). The CLI runs from ContextAnvil's own directory.
Temporary roots are removed after the run. Choose a result path outside the snapshots.
The published result normalizes only the absolute snapshot root from the CLI reports.

`labels.tsv` uses a dash for absent path, line, key or severity. The optional key
identifies a specific subject in the finding title. An unkeyed line is part of the
matching selector. With a key, the cited line is assessed separately as evidence.
A finding can match only one case. Additional matching findings and unmatched findings
are retained outside the scoring panel. Evidence accuracy counts whether the
expected anchor is present, with whole-file labels requiring the path only.

Precision = TP/(TP+FP), recall = TP/(TP+FN), F1 = 2TP/(2TP+FP+FN), and
false-positive rate = FP/(FP+TN). These describe only frozen, supported,
determinate cases. An empty denominator is unavailable. Ambiguous and unsupported
cases are shown separately, as are unmatched findings. Wilson intervals quantify
binomial sensitivity to the denominators only; clustering and purposive sampling
prevent population inference.

Treat this frozen panel as a disclosed baseline. Cases inspected in failure analysis
are no longer blind. Tune fixes on distinct repositories or synthetic development
fixtures and reserve a new, independently labeled, sealed holdout before tuning.
Replay this panel unchanged to detect regressions.
