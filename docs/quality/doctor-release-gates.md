# Doctor release gates (proposed, pre-registered)

These gates decide whether the independent holdout supports a stable v1.0 claim about Doctor. They are
written before any holdout execution and recorded machine-readably in
[`gates.json`](../../bench/doctor/holdout/gates.json). The evaluation lock stores that file's digest, so no
value can change after labels exist. They are **proposed**: the maintainers ratify them (set `status` to
`ratified` in a reviewed commit) before the lock. The lock refuses unratified gates.

The goal is trustworthy evidence, not an attractive number. Every limit below is therefore tied to a
stated reason, and every test uses a confidence bound rather than a point estimate.

## How a gate is decided

- **Bound, not point estimate.** A proportion gate is met only when the exact one-sided 95% binomial
  (Clopper-Pearson) bound clears the limit: the lower bound for precision, recall and agreement, the
  upper bound for the false-positive rate. A lucky small sample cannot pass.
- **What a limit means.** Every floor and ceiling is a product decision, not a law of nature. The
  justification given is the reason that value, rather than a neighbouring one, is defensible. Where a
  value is a policy choice it says so. The sample sizes follow from the limits, not the reverse.
- **Clustering.** Findings within a repository are correlated, so a gate must also hold on a
  leave-one-repository-out basis, in which each repository is dropped in turn and the point estimate
  must still clear the limit. Population claims are not made from ten repositories.
- **Statuses.** `pass`, `fail`, `unvalidated` (coverage minimum unmet, so no gate was applied),
  `not-exercised` (empty denominator) and `incomplete` (inputs such as the audit are still missing).
  Only `pass` supports a claim. Anything else supports no claim.

## Confirmed defects and informational cues

The two are measured on separate denominators and never pooled.

| | Confirmed defect | Informational review cue |
| --- | --- | --- |
| Reviewer label | `class = defect`, severity `warning` or `error`, with a concrete next action | `class = cue`, severity `info` |
| Tool output it is compared with | findings emitted at `warning` or `error` | findings emitted at `info` |
| Question asked | Is this claim true, and would acting on it fix something? | Is the observation true and worth a human look? |
| Gated by | defect precision, defect recall, false-positive rate, severity | cue factual accuracy |
| Never claimed | that a cue is a defect, or that a cue proves exposure | recall of cues (reported, not gated) |

A filename that conventionally holds credentials, a lifecycle hook and a declared tool server are cues.
Counting them as detected defects would inflate recall, and counting a wrong cue as a failed defect
would understate precision, so neither is done.

## Accuracy gates

| Gate | Limit | Population | Why this limit |
| --- | --- | --- | --- |
| Defect precision | lower bound ≥ 0.80 | Every emitted `warning` or `error` finding, whether it matched a reviewer label or was audited afterwards | A `warning` is defined as a demonstrated misleading instruction. A reader acts on it, and a wrong one wastes their time and erodes trust in the next. A floor of 0.80 at the bound means that, with enough evidence, at most about one in five acted-on warnings is wrong. The earlier disclosed baseline's bound was far below it. **Policy choice.** |
| Defect recall | lower bound ≥ 0.50 | Determinate supported `defect` opportunities | A heuristic, deterministic checker is allowed to be silent where it cannot be sure: a miss is no worse than having no checker, while a false claim actively misleads. Half is the smallest floor that is demonstrably better than missing as many as it finds. Unsupported opportunities are excluded and reported separately so scope limits stay visible. **Policy choice.** |
| False-positive rate | upper bound ≤ 0.10 | Determinate explicit negative opportunities | A negative is a place a careless tool would raise a wrong claim. At 0.10 an agent that follows a clean repository's reports meets a false claim at most about one time in ten. |
| Cue factual accuracy | lower bound ≥ 0.90 | Every emitted `info` finding, matched or audited | A cue states a deterministic fact (a file exists, a hook is declared). It can fail only by misdescribing the source, so the floor is higher than for a judgement call. |
| Evidence correctness | lower bound ≥ 0.90 | Findings judged correct | Evidence is how a human verifies a finding. An anchor that does not identify the source defeats the purpose even when the claim is true. An anchor comes from the same parse that raised the finding, so near-perfect is expected. |
| Severity agreement | lower bound ≥ 0.80 | Findings judged correct | Severity is a judgement, so it is held to the same bar as precision, not the evidence bar. Exact agreement with the adjudicated severity is required. |
| Leave-one-repository-out | point estimate clears the precision, recall and false-positive limits for every fold | Overall | Guards against a gate that holds only because of one repository. |

### Why the sample sizes are what they are

The coverage minimums are the smallest numbers for which the gate **can** be passed at all, computed from
the limits with zero failures (`n ≥ ln 0.05 / ln floor`):

| Requirement | Derivation | Minimum |
| --- | --- | ---: |
| Negatives (false-positive rate upper bound ≤ 0.10) | 0 false positives in 29 trials gives an upper bound of 0.098 | 29 |
| Defect precision ≥ 0.80 | 0 wrong in 14 correct claims gives 0.807; one wrong needs 22, two need 30, three need 37 | 14 |
| Defect recall ≥ 0.50 | 0 misses in 5 gives 0.549; one miss needs 8, two need 11, three need 13 | 5 per category |
| Cue accuracy ≥ 0.90 | 0 wrong in 29 gives 0.90 | 29 |

So the overall run needs at least **14 determinate defect positives and 29 determinate negatives**, and
each category that is to be gated needs **at least 5 defect positives and 29 negatives**. These are
minimums at which a flawless result passes. A realistic result needs more. At 60 correct claims, for
example, 2 wrong still clears 0.80 at the bound. The documents and repositories are only the source of
opportunities. The counts above are opportunities.

Further coverage conditions, so that a few easy repositories cannot carry the result:

- defect positives from at least **3 repositories**, and no repository holding more than **50%** of them
  (the sample is clustered, so one repository must not dominate);
- **24 of 24** reserved instruction documents swept in every category by both reviewers;
- a category below its minimum is `unvalidated`, never passed by default.

## Security gates (zero tolerance)

These count events, so they are not sampled proportions. The limit is zero because a single event is a
product defect, not noise. Each is checked mechanically on the raw output of the one locked run.

| Gate | Limit | How it is checked |
| --- | --- | --- |
| Credential value in any output | 0 | Tokens on the lines that both reviewers marked as live credentials are searched for in stdout and stderr. Any hit is reviewed by the custodian and counts unless marked benign. Fingerprints, never values, are recorded. |
| Non-ASCII or control byte in output | 0 | Every output byte must be tab, line feed or printable ASCII. This is the project's own output rule. |
| Evidence path outside the snapshot | 0 | Every evidence path must be relative, free of `..`, and present in the pinned tree listing. |
| Snapshot modified | 0 | The snapshot is compared with its pinned blob ids before and after the run. |
| Non-deterministic repeat | 0 | A second run's normalized output must equal the first. |
| Uncaught failure | 0 | Non-zero exit, any stderr output, unparseable JSON or a `detector-failed` finding. |
| `error`-severity false positive | 0 | Every `error` finding must be correct **and** adjudicated as `error`. If none occur, the gate is `not-exercised`, which supports no claim about `error` accuracy. |

**Security-sensitive detection** (credentials in instructions, instruction-hijacking text, hidden content) is
gated like any category only when there are at least **5 determinate security defect positives**. The
holdout is drawn from public repositories whose maintainers are unlikely to commit live credentials or
attacks. The security positives will therefore probably be too few to measure recall. If so the gate is
`unvalidated`, and the release documentation must say that these detectors are covered by synthetic
tests and not by held-out measurement. Seeded synthetic corpora measure that separately.

## Runtime regression gate

The locked candidate and the previously published candidate run interleaved on the same machine, with
the existing [paired profiler](../../bench/doctor/profile.js): one warm-up then **7 measured pairs per
snapshot**, using medians.

| Metric | Limit | Why |
| --- | --- | --- |
| Median wall time, candidate ÷ baseline, per snapshot | ≤ 1.20 | In the recorded hardening profile the original and corrected engines differed by at most 1.6% in median latency and peak RSS, so that is an upper estimate of paired noise on that machine. A 20% limit is over ten times that, so it catches a real algorithmic regression without flagging jitter. **Policy choice.** |
| Median peak RSS, candidate ÷ baseline, per snapshot | ≤ 1.20 | Same reasoning. |

Absolute latency is not gated because it depends on the machine. Defaults for file and depth limits stay
unchanged for the run, so a snapshot that exceeds them produces a `file-limit` finding, which is
reviewed like any other.

## Decision rule

- **GO** – every coverage requirement for every category the release documentation describes as accurate is
  met, all accuracy gates pass, and all security and runtime gates pass.
- **SCOPED GO** – as above, except that some categories are `unvalidated`. The release may proceed only if
  the documentation says so for those categories and makes no accuracy claim for them.
- **NO-GO** – any failed gate in a validated category, any non-zero security gate, unmet overall coverage,
  or an engine, label, rule or gate change after the lock.
- **Incomplete** – anything pending (audit, profile, review). No claim is allowed.

A failure is not repaired by tuning on the same holdout. The inspected holdout is disclosed and cannot
support a blind claim again. Fix on separate inputs, reserve a new sealed holdout, and relabel.

## Limits of this evidence

Ten repositories and 24 instruction documents are a purposive sample. Intervals describe sampling noise
in these opportunities. They do not describe the population of repositories. Reviewer agreement bounds how
good the labels are. Two reviewers are the minimum for estimating it. Unmatched tool findings are judged
after the run, which means the reviewers see claims that were produced by the tool. The audit queue hides
the tool's severity, mixes in control items drawn from the locked labels so that reviewers cannot tell tool
findings from controls, shuffles the queue and uses the frozen rubric. Reviewer agreement on the controls
is reported. This reduces but does not remove that bias. The report must disclose the audit denominator.
