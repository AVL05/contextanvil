# Doctor hardening verification

## Baseline and development

[PR #18](https://github.com/AVL05/contextanvil/pull/18) changed only benchmark
and quality files. All 11 checks passed. Its replay matched the archived
result, including the corpus and label hashes, after excluding the field
that records the executing Git revision. It was squash-merged at
`e30d9a4345ddad817ead16d57279bca18f51dacb`. The
[historical report](doctor-evaluation.md), [coverage matrix](detector-coverage.md),
labels, freeze and raw baseline are unchanged.

The hardening uses [separate development inputs](../../bench/doctor/development-set.md).
New regressions use synthetic temporary trees and existing test conventions.
The first run of each regression group reproduced the defect before the
correction. The historical replay also exposed an umbrella-guide regression.
A separate synthetic fixture reproduced the same ambiguity and now covers it.

| Area | Root cause | Correction and checks |
| --- | --- | --- |
| Commands | Text matching discarded working directory, workspace ownership, alternatives and shell context. | Parse a bounded literal subset. Check the owning package for nested guides, directory changes and supported single-package selectors. Skip ambiguous umbrella scopes, comments, non-shell fences and optional examples. Validate both existing and missing scripts. |
| Package managers | A repository-wide union treated incidental commands as install policy. | Group by owning manifest and use its declared manager or a unique local lockfile. Verify a genuine install mismatch and preserve existing conflict evidence. |
| Paths | Root assumptions and blanket exclusions conflated source, generated output and external or dependency-relative paths. | Resolve local links and imports relative to the guide. Treat quoted paths as heuristic. Check missing source paths under `build/` only with a source cue and an existing parent. Skip clearly generated or external paths and repeated same-scope symlink aliases. |
| Guide size | A fixed character threshold treated forwarding stubs and scoped overrides as empty. | Accept short local imports, links and useful scoped text. Detect empty guides and missing import targets separately. |
| Diagnostic calibration | A filename, event name or config key was treated as stronger evidence than it supports. | Use informational sensitive-file and fixture-parse findings. Identify lifecycle phases and whether an MCP declaration is local or remote. Provide a review action without alleging execution or compromise. |

The command parser does not interpret arbitrary shell scripts, evaluate
configuration, validate package-manager workspace semantics, or check
native Composer, Python, Cargo or Go commands. Relative path interpretation,
English context cues, and security patterns remain heuristic. The public
Doctor schema version is unchanged. `--excerpts` adds an optional evidence
field. Path-only sensitive-file notes and intentionally invalid fixture parse
notes no longer cause the default warning threshold to fail.

## Historical replay

Run the unchanged harness after committing the engine changes:

```sh
node bench/doctor/run.js /absolute/path/to/doctor-hardening-replay.json
```

The [raw replay](../../bench/results/doctor-hardening-replay.json) includes
all findings, per-ID and per-ecosystem metrics and unmatched outputs.
The table uses the original determinate labels.

| Category | Baseline TP / FP / FN / TN | Candidate TP / FP / FN / TN |
| --- | ---: | ---: |
| Missing | 0 / 3 / 0 / 2 | 0 / 0 / 0 / 5 |
| Conflict | 0 / 2 / 0 / 2 | 0 / 0 / 0 / 4 |
| Stale | 0 / 5 / 3 / 21 | 1 / 0 / 2 / 26 |
| Unsafe | 3 / 0 / 0 / 1 | 3 / 0 / 0 / 1 |
| Scan | 0 / 0 / 0 / 0 | 0 / 0 / 0 / 0 |
| Total | 3 / 10 / 3 / 26 | 4 / 0 / 2 / 36 |

Precision moved from 23.1% (3/13) to 100% (4/4), recall from 50.0%
(3/6) to 66.7% (4/6), F1 from 31.6% to 80.0%, and FPR from
27.8% (10/36) to 0% (0/36). Nominal 95% Wilson intervals for the
candidate are 51.0–100% for precision, 30.0–90.3% for recall, and
0–9.6% for FPR. These intervals do not address clustered or purposive sampling.
Four matched positives cited the expected source and severity (4/4 for each).
All four name what to inspect and include a review action (4/4, previously
0/3 had an explicit action). The new hit cites the obsolete PHPStan source
reference. The other three remain Composer lifecycle review signals.

The two remaining frozen false negatives are the fenced examples already
documented as label errors in the original evaluation. The labels are unchanged.
The two examples still correctly produce no warnings. There are 14 ambiguous
and 9 unsupported cases. Of 43 emitted findings, 28 were outside the frozen
panel. For example, Cloudflare Agents still gets a false missing-path warning
for a directory in another repository (`docs/AGENTS.md:26`). Its `pnpm dev`
warning now cites the owning `examples/playground/package.json`, which
defines `start` but no `dev` script. These observations are outside the
scoring panel. The historical corpus is disclosed and informed development
priorities. Its replay measures regression against that panel and does not
establish real-world release accuracy.

## Performance and memory

On Windows with Node.js 24.22.2, [the profiler](../../bench/doctor/profile.js)
alternated the baseline and candidate in separate processes. It discarded one
warm-up pair and recorded seven pairs per input. Elapsed time covers scan and
diagnose, excluding Node startup and JSON rendering. Peak RSS is process-wide.
Use only trusted ContextAnvil engine checkouts as the first two arguments.

```sh
node bench/doctor/profile.js BASELINE_CHECKOUT CANDIDATE_CHECKOUT REPOSITORY...
```

| Input | Median latency, baseline → candidate | Median peak RSS, baseline → candidate |
| --- | ---: | ---: |
| Next.js development fixture | 37.0 → 33.1 ms | 54.9 → 55.0 MiB |
| Cloudflare Agents pinned export | 385.2 → 382.7 ms | 76.3 → 74.9 MiB |
| PHPStan pinned export | 592.7 → 637.9 ms | 78.8 → 78.9 MiB |

The PHPStan sample took 7.6% longer. The other medians decreased, and RSS
varied by less than 1.4 MiB. These are small, host-specific measurements with
filesystem timing variability. See the [individual samples](../../bench/results/doctor-hardening-profile.json).

## Diagnostic output security

This is a targeted defensive review of the Node CLI, public analysis results
and Skill launcher. No independent security audit was conducted.

| ID | Severity | Finding and verification |
| --- | --- | --- |
| S1 | High | Credential-shaped filenames, paths and exported symbol names could appear in scan, Doctor and context output. The walker omits matching names and unsafe symlink targets, symbol and task display text is redacted, and fixtures verify JSON, text and API output. The filesystem path used by the reader stays separate from the displayed root. |
| S2 | High | Diagnostic interpolation, error output and invalid nested config values could disclose credential-shaped strings. Diagnostics and expected errors are sanitized, unexpected errors omit raw stacks, and Prettier data is type-checked before publication. Tests cover script names, fact identifiers, manifest evidence and malformed inputs. |
| S3 | High | Private-key redaction could miss long blocks or shift evidence lines. Delimiter matching redacts long and unfinished blocks while preserving line boundaries. Regression tests check original line numbers and adversarial input. |
| S4 | Medium | Verifying a finding could require an agent to open a full guide containing a flagged secret. Optional `--excerpts` shows only the cited stale/conflict instruction line, up to 120 characters and at most four per finding. Secret-flagged or redacted lines and unsafe findings are excluded. Evidence remains untrusted. |
| S5 | Medium | A disclosure verb and a credential term in separate clauses could falsely imply a disclosure instruction. The rule now requires a bounded direct-object pattern. Tests retain explicit disclosure and check policy prose and negation. |

Pattern-based redaction cannot establish that output is free of secrets.
Filename heuristics can omit harmless paths or miss unusual token formats.
The Skill can advise an agent to avoid flagged content. It cannot enforce
what the agent reads with its own tools. The bundled engine uses no network
or process execution and never writes to the scanned repository.

## Skill integration

Tested on Windows 11 with Node.js 24.22.2, `skills` 1.7.6,
Claude Code 2.1.318 and Codex CLI 0.166.0. Project-scope
`npx skills add <local-skill> --agent claude-code codex --skill contextanvil --copy --yes`
installed both launchers in an isolated synthetic project. Both installed
paths returned the expected missing script and missing path. The Node 22
minimum is covered by engine CI and the launcher rejects older versions.

| Check | Claude Code | Codex CLI |
| --- | --- | --- |
| Implicit activation | Plain audit request loaded the `contextanvil` Skill and ran the launcher. | Standalone read-only session opened the installed `SKILL.md` and ran the launcher. |
| Explicit activation | `/contextanvil` loaded the instructions and ran the launcher. | `$contextanvil` ran the installed launcher in a standalone read-only session. |
| Result | The launcher returned two warnings with the intended source lines. Exit 1 was the expected findings status. | The launcher returned the same two warnings and exit status. |
| Permissions | Normal permissions remained enabled. The retry permitted only the specific launcher invocation. | Desktop-inherited registered Core process launch failed before Node. Standalone sessions used `--sandbox read-only` without desktop process-routing variables. |

No global settings or sandbox permissions were changed. These are smoke
tests on one Windows host with a synthetic fixture. They do not establish
activation rates or real-session behavior on Linux, macOS or other Windows
setups. The sessions used the first hardening revision. The automated suite
also verifies the final vendored copy, evidence, errors and read-only behavior.
See the [installer CLI reference](https://github.com/vercel-labs/skills/blob/main/docs/commands.md),
[Claude Code skill documentation](https://code.claude.com/docs/en/skills)
and [OpenAI Codex skill documentation](https://developers.openai.com/codex/skills).

## Release blockers

- The [holdout reservation](../../bench/doctor/holdout/README.md) pins 10 other
  public repositories and 24 instruction paths. No independent reviewers
  labeled the inputs, so the holdout was never run. Independent labeling,
  adjudication and a sealed run are required for release-level accuracy claims.
- Most categories still lack representative positive and negative counts.
  In particular, Composer advisories provide no recall estimate for real
  credential exposure, injection or hidden-content incidents.
- The desktop-inherited Codex Windows launch failure prevents a compatibility
  claim for that environment. Standalone CLI results do not resolve it.

**Decision.** Proceed with code review and independent evaluation. Stable v1.0
readiness remains unverified.
