# Doctor accuracy baseline for v1.0

**GO for targeted hardening on a separate development set. NO-GO for using this
baseline as v1.0 accuracy evidence.** The only supported positives detected were
Composer lifecycle review signals. The panel exposed misleading warnings for
valid instructions and a missed reference to a moved PHP source file.

## Corpus and reproducibility

The baseline engine is `c8b2624b743902db0cdbd9f3eeb5ee91b85aa2bb`. The
[manifest](../../bench/doctor/corpus.json) records every commit, source archive
SHA-256, instruction path and license source. Source archives are not redistributed.

| Ecosystem | Public repository | Instruction paths |
| --- | --- | ---: |
| Next.js / React | agentsmd/agents.md | 1 |
| JavaScript | eslint/eslint | 1 |
| TypeScript / React | cloudflare/agents | 9 |
| PHP / Laravel | laravel/laravel | 2 |
| PHP / Laravel | filamentphp/filament | 2 |
| PHP | phpstan/phpstan-src | 3 |
| Python | openai/openai-python | 1 |
| Go | modelcontextprotocol/go-sdk | 1 |
| Go | charmbracelet/crush | 4 |
| Rust | astral-sh/ruff | 2 |
| Rust | nushell/nushell | 2 |
| **Total** | **11 repositories** | **28** |

We selected public projects across ecosystems and then reviewed the exported
tree. Pest was considered and dropped before labeling because its source
export omitted its instruction file. These are pinned GitHub source exports.
They lack Git metadata and can omit tracked paths (for example Filament's
`.gitignore`). The Nushell alias retains its symlink. Nested files in the same
repository and aliases are correlated.

The [rubric and reproduction command](../../bench/doctor/README.md),
[labels](../../bench/doctor/labels.tsv) and [freeze hashes](../../bench/doctor/freeze.json)
predate the first Doctor invocation on the corpus. One reviewer made two
source-only passes. The published [raw baseline](../../bench/results/doctor-baseline.json)
retains each CLI finding, its evidence and the unmatched findings. It normalizes
the local root. The [coverage matrix](detector-coverage.md) includes untested IDs.

## Frozen panel results

65 reviewed opportunities, of which 42 were scored, 14 ambiguous and 9
unsupported. Of 58 emitted findings, 13 matched determinate labels, 13 matched
ambiguous labels and 32 were outside the panel. Precision is conditional on the
13 adjudicated determinate hits. The qualitative review below covers the other
outputs without adding them to the frozen denominator.

| Category | TP | FP | FN | TN | Ambig. | Unsupported | Precision | Recall | F1 | FPR |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| Missing | 0 | 3 | 0 | 2 | 12 | 0 | 0% | — | 0% | 60.0% |
| Conflict | 0 | 2 | 0 | 2 | 2 | 0 | 0% | — | 0% | 50.0% |
| Stale | 0 | 5 | 3 | 21 | 0 | 6 | 0% | 0% | 0% | 19.2% |
| Unsafe | 3 | 0 | 0 | 1 | 0 | 3 | 100% | 100% | 100% | 0% |
| Scan | 0 | 0 | 0 | 0 | 0 | 0 | — | — | — | — |
| **Total** | **3** | **10** | **3** | **26** | **14** | **9** | **23.1%** | **50.0%** | **31.6%** | **27.8%** |

| Ecosystem | TP / FP / FN / TN | Precision | Recall | F1 | FPR |
| --- | --- | ---: | ---: | ---: | ---: |
| Next.js / React | 0 / 2 / 0 / 2 | 0% | — | 0% | 50.0% |
| JavaScript | 0 / 1 / 0 / 2 | 0% | — | 0% | 33.3% |
| TypeScript / React | 0 / 2 / 2 / 10 | 0% | 0% | 0% | 16.7% |
| PHP / Laravel | 2 / 1 / 0 / 1 | 66.7% | 100% | 80.0% | 50.0% |
| PHP | 1 / 1 / 1 / 2 | 50.0% | 50.0% | 50.0% | 33.3% |
| Python | 0 / 0 / 0 / 2 | — | — | — | 0% |
| Go | 0 / 1 / 0 / 4 | 0% | — | 0% | 20.0% |
| Rust | 0 / 2 / 0 / 3 | 0% | — | 0% | 40.0% |

The dash indicates an empty denominator. Per-ID metrics and Wilson intervals are
in the raw baseline. Overall nominal 95% Wilson intervals are 8.2–50.3% for
precision, 18.8–81.2% for recall and 15.8–44.0% for FPR. The small, purposive,
clustered panel cannot support repository-population estimates. There are no
positive examples for most IDs. In particular, the unsafe scores are three
lifecycle events across two repositories. They say little about prompt injection,
secrets or hidden content.

**Label audit after unblinding.** Cloudflare's two alleged broken RFC links are
inside a fenced Markdown example (`design/AGENTS.md:32–37`). They were mistakenly
labeled as live links. Silence is correct in both cases. Treating both as harmless
in a sensitivity calculation gives 3 TP, 10 FP, 1 FN, 28 TN, 23.1% precision,
75.0% recall, 35.3% F1 and 26.3% FPR. For stale alone it gives 0/1 recall and
5/28 FPR. Also, the frozen Cloudflare manager row rationale overlooked a real
`npm run` invocation in a pnpm workspace. The warning still mischaracterizes
the scoped script invocation as a repository-level conflict. These corrections
are recorded here and leave the original labels and primary results intact.

## Evidence, severity and actionability

All 3 true positives cited the expected Composer manifest line and had the
expected informational severity (3/3 for each, nominal Wilson 43.8–100%).
All three identify a specific declaration that a reviewer can inspect (3/3),
and none specifies a next step or the exact event conditions (0/3). This
actionability assessment distinguishes ability to investigate from a prescribed
remediation. The 10 false positives in the frozen panel carry warning severity
and have no justified remediation. For example, deleting a valid short guide
or changing a working workspace command would remove useful instructions.
Evidence anchors can be syntactically correct while supporting the wrong claim.
The evidence score is conditional on matched findings with a primary anchor and
does not measure evidence missing from undetected issues.

## Failure analysis

The commit links resolve the exact corpus snapshots. Findings identified by
`#n` below are one-based indexes within that repository's raw report. All
listed outputs and absences can be reproduced using the pinned archive and
baseline command. Root causes are hypotheses from source inspection.

| Frozen result | Snapshot and source | Expected and observed | Explanation |
| --- | --- | --- | --- |
| FP, warning | [agentsmd/agents.md](https://github.com/agentsmd/agents.md/blob/d001185d792eb6402a58e4cbef1c228b309ec25d/AGENTS.md#L8-L36) | Suppress manager conflict for explicit dev alternatives. Suppress missing test for the conditional recap. Emitted #1–2. | Collects manager tokens across code spans without checking equivalence, and treats conditional examples as directives. |
| FP, warning | [Cloudflare Agents](https://github.com/cloudflare/agents/blob/55752144ac2c553e0ea8047b37c69e073ecd1755/agent-think/AGENTS.md#L140-L150) | The CA path is locally supplied and the scoped npm invocation is for an existing script. Emitted #2–3. | Repo-wide manager aggregation collapses scope and script use into install policy. Physical path matching does not account for documented local setup. |
| FP, warning | [ESLint](https://github.com/eslint/eslint/blob/af4c3a9cc7c770419532b191ac465d4a1566eb0c/AGENTS.md#L42) | Resolve start in `docs/package.json` after `cd docs`. Emitted #1. | Root script set is used regardless of command working directory. |
| FP, warning | [Ruff](https://github.com/astral-sh/ruff/blob/3cd7c518989cb1f0656db144c8caf42b97d58673/CLAUDE.md), [Filament](https://github.com/filamentphp/filament/blob/9d78093cfebdc96c077b1d8dbf94b41738f28992/CLAUDE.md), [Crush](https://github.com/charmbracelet/crush/blob/fedf5b82b392d2e02226b196c83f593c03d27803/internal/cmd/stats/AGENTS.md) | Accept import stubs and the focused local override. Each emitted #1. | A character threshold ignores references and inherited context. |
| FP, warning | [Nushell](https://github.com/nushell/nushell/blob/a4819256a2d875ca42c8600242388da291f3beaa/AGENTS.md#L15) | Build output is generated and configurable. Emitted #1 and repeated via alias in #2 (outside panel). | Output directory exclusions lack Cargo context. Path check runs on both alias and canonical instructions. |
| FP, warning | [PHPStan](https://github.com/phpstan/phpstan-src/blob/24ba68cf280ea45f341189d42e7252970901914a/turbo-ext/CLAUDE.md#L625-L630) | Both parser paths are dependency-relative. Emitted #5 and its sibling #4 (outside panel). | Resolution has no dependency scope even when the sentence explicitly supplies it. |
| FN, expected warning | [PHPStan](https://github.com/phpstan/phpstan-src/blob/24ba68cf280ea45f341189d42e7252970901914a/turbo-ext/CLAUDE.md#L69-L85) | Report `build/TurboAttributeCollector.php`, which actually lives at `build/PHPStan/Build/TurboAttributeCollector.php`. No finding. | An early exclusion suppresses all references beginning with `build/`, including checked-in source. Repeated at lines 84, 409 and 529. |
| Frozen FN, label error | [Cloudflare Agents](https://github.com/cloudflare/agents/blob/55752144ac2c553e0ea8047b37c69e073ecd1755/design/AGENTS.md#L32-L37) | No warning for either example link. No finding. | The detector correctly skips fenced examples for path checks. Both labels lacked the surrounding fence context. |

### Other emitted findings

This is a descriptive review, separate from the frozen scoring. Short repository
names refer to the exact commit in the corpus manifest. Unless stated otherwise,
warnings are the observed severity for stale, sensitive-file and scan findings.

| Repository and raw indexes | Evidence and assessment |
| --- | --- |
| Cloudflare #4 | `docs/AGENTS.md:26` points to a directory in another repository. No local stale warning is warranted. The parser disregards the scope explicitly stated in prose. |
| Cloudflare #5–6 | `AGENTS.md:81` gives a valid example-scoped dev command after a directory change. Line 10 describes published npm packages in a directory tree. Neither is a missing root script. The same regex examines all fenced text, including comments. |
| PHPStan #3 | `apigen/infra/CLAUDE.md:133` explicitly names an external repository. No local stale warning is warranted. Same scope problem as Cloudflare #4. |
| OpenAI Python #6 | `AGENTS.md:15` restricts publish credentials. No disclosure instruction is present. The pattern matches a release verb and the word “credentials” across clauses. This is an additional warning-level false positive outside the scored panel. |
| ESLint #3–5 | Large test asset and two intentionally broken package.json fixtures. The limits/parsing observations are reproducible, but treating these as repo health warnings is misleading. The scanner does not distinguish fixture scope. |
| Filament #7 | `.gitignore` is absent in the export and [present at the commit](https://github.com/filamentphp/filament/blob/9d78093cfebdc96c077b1d8dbf94b41738f28992/.gitignore). This informational result is an archive artifact. No repository correction follows. |
| OpenAI Python #1–5 | The mTLS paths are used by `tests/test_mtls_http_client.py`. No exposure was established. Ignoring or purging these tracked test assets is not justified by filenames alone. |
| Ruff #2–6, Crush #2, ESLint #2, Filament #2–5, Laravel #1 | Unignored sensitive-looking filenames. File contents and live credentials were not evaluated. Treat the paths as review cues and verify their intended role before recommending removal. |
| Ruff #8, Cloudflare #8 | Ruff's settings declare hooks. Cloudflare's config declares a remote MCP endpoint. Both merit config review, but the “can run commands” title does not distinguish a local executable hook from a remote service. |
| Cloudflare #7, ESLint #6 | Accurate single-client observations at informational severity. No documented need to add another client. |
| Nushell #2, PHPStan #4 | The alias duplicate and the sibling vendored parser path are discussed in the frozen failure table. |

Thirteen additional outputs matched ambiguous labels. For the five matched
single-client notes (agentsmd, Crush, Go SDK, OpenAI Python and PHPStan), client
requirements are unknown. Ruff's size note and the Cloudflare/PHPStan size
warnings describe measured bytes, but do not establish excessive context for the
scoped reader. ESLint's build note selects a docs-maintenance script, Filament's
test note ignores the documented Composer workflow, and Laravel's build note
evaluates a bootstrap guide as though it were the generated project guide.
Laravel's duplicate-guide note establishes identical bytes. Whether the
template maintains both files from one source was not established.

## Security-sensitive findings

- Three informational Composer hooks are valid review signals. The evidence
  establishes declarations and phases, not malicious intent or an executed hook.
- Laravel's pinned bootstrap requests direct execution of downloaded prerequisite
  code using shell substitution or PowerShell evaluation (`AGENTS.md:20,26,32`).
  These three cases were frozen as unsupported. They are candidates for expanded
  detection and do not count as false negatives of the literal pipe rule.
- No actual credential exposure was verified. No suspicious commands, package
  hooks, settings or downloaded project code were executed. Sensitive path
  results must not be interpreted as evidence of a leak.

## Priorities for hardening

| Priority | Work | Classification |
| --- | --- | --- |
| P1 | Respect command scope and intent in existing Node warnings. Cover explicit directory changes, nested workspaces, fenced comments and conditional/alternative commands. | Confirmed defects |
| P1 | Use explicit path context to separate checked-in source from generated or dependency-relative paths. Retain the existing exclusion for genuine build artifacts. | Confirmed defects |
| P1 | Prevent security prose about credentials and publishing from being labeled a disclosure request without stronger contextual evidence. | Confirmed defect outside scored panel |
| P2 | Distinguish short imports and scoped overrides from empty guides. Avoid duplicate path alerts from aliases. | Confirmed defects |
| P2 | Review severity and recommendations for fixtures, sensitive filenames, secondary script omissions and scoped size warnings. | Calibration and evidence wording |
| Later | Evaluate coverage for remote shell substitutions, PowerShell execution, and native Composer/Cargo/Go/Python workflows. | New capabilities, outside this baseline |

Use different development repositories and targeted fixtures for corrections.
The disclosed baseline stays frozen. Reserve an independently labeled, sealed
holdout with more supported positives per category before using accuracy as a
release gate. The local suite ran 147 tests (145 passed, two platform-specific
skips); the Skill sync check passed. The real-repository benchmark is an
explicit run, separate from the standard CI fixture suite.
