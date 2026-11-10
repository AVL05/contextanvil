# PR #19 engineering review

Reviewed `37b10b97a52c8dbc4dd2f11580759a84e39afb77` against main
`e30d9a4345ddad817ead16d57279bca18f51dacb`, including the runtime,
tests, generated Skill, benchmark tools, and documentation. Review fixes
are in `ff51552` and `e1b7e23`. The [historical baseline](doctor-evaluation.md) and
[published candidate replay](../../bench/results/doctor-hardening-replay.json)
remain unchanged. The reserved holdout was not materialized or scored.

## Confirmed defects and corrections

| Area | Observed at the original candidate | Correction |
| --- | --- | --- |
| Command scope | `cd --` silently kept the previous directory. A comment containing a conditional phrase caused a dynamic `cd` to be skipped. A regular file could be accepted as a directory, and a directory alias fell back to the wrong ancestor manifest. | Recognize the literal delimiter, invalidate unknown directory state, and resolve actual in-tree directories through the safe reader. The regressions check nested evidence, in-tree aliases and rejected external aliases. |
| Manager behavior | A pnpm argument after the script name could be mistaken for a workspace selector. A valid default `npm start` was reported as missing. | Respect pnpm's argument boundary and recognize npm's default when the package contains an indexed `server.js`. Explicit selectors before the script still resolve. [pnpm run](https://pnpm.io/cli/run), [npm start](https://docs.npmjs.com/cli/start.html/) |
| Path scope and evidence | A document-relative missing link was checked in the right place but displayed a root-looking path. One explicit cross-repository porting note and one multi-line vendored-file note triggered local path warnings. | Show the resolved document-relative target. Recognize explicit external folder scope and carry dependency context within a bounded paragraph. Preserve warnings for subsequent local references. |
| Scan wording | A source archive that omitted a tracked root `.gitignore` produced a claim about the repository and a recommendation to add the file. | Describe what the scan found and ask the reader to check the source checkout and exclusions. |
| Excerpt safety | Truncation could split a surrogate pair. A standalone carriage return could reach the terminal in an excerpt. | Count Unicode code points, preserve CRLF boundaries, and neutralise isolated carriage returns before display. Skip filesystem names containing line breaks or tabs. |

The focused regressions reproduced the command, path and excerpt defects
before correction. Existing positive findings for conflicting managers,
missing scripts and missing paths remain covered. The command parser still
checks a literal subset, with no shell evaluation or complete workspace
semantics. Secret matching remains heuristic.

## Audit of all 28 out-of-panel findings

Each `#` is the one-based finding index in the named repository's report
from the [published replay](../../bench/results/doctor-hardening-replay.json).
The [historical corpus](../../bench/doctor/corpus.json) gives exact commits
and archive hashes. All 11 archive hashes were verified. Git independently
confirmed that the 17 filename-only paths are unignored in the exports. For filename-only
notes, **correct** means the scan identified an unignored sensitive-looking
name in the export. The note does not establish secret contents or a leak.
Sensitive files were not opened during the review.

| Repository and finding | Classification | Source evidence and rationale |
| --- | --- | --- |
| Ruff #2 | Confirmed correct | `.claude/settings.json` has a hook section with local command declarations. The finding asks for review. |
| Ruff #3 | Confirmed correct | `playground/.npmrc` is an unignored npm configuration filename in the export. |
| Ruff #4 | Confirmed correct | `playground/api/.dev.vars` is an unignored environment filename in the export. |
| Ruff #5 | Confirmed correct | `playground/api/.npmrc` is the API package's own configuration path. |
| Ruff #6 | Confirmed correct | `playground/deploy/.npmrc` is a separate deploy configuration path. |
| Ruff #7 | Confirmed correct | `scripts/ty_benchmark/.npmrc` belongs to the benchmark directory and is independently present. |
| Crush #2 | Confirmed correct | Root `.envrc` is an unignored environment filename. The note makes no statement about its contents. |
| Cloudflare Agents #2 | Confirmed false positive | `docs/AGENTS.md:26` identifies `src/content/docs/agents/` as the destination in `cloudflare/cloudflare-docs`. It is outside the scanned repository. |
| Cloudflare Agents #3 | Confirmed correct | `AGENTS.md:80–81` explicitly names `examples/playground`. Its manifest defines `start` and has no `dev` script. The owning manifest supersedes the earlier broad assumption about other examples. |
| Cloudflare Agents #4 | Ambiguous | The export has `AGENTS.md` and lacks `CLAUDE.md`. The need for a second client guide is unverified. |
| Cloudflare Agents #5 | Confirmed correct | `.mcp.json` declares an MCP endpoint via a URL. The note describes a remote integration. |
| ESLint #1 | Confirmed correct | `tests/bench/large.js` is 725,713 bytes, above the default 524,288-byte limit. This is an analysis limit for a benchmark asset. |
| ESLint #2 | Ambiguous | The export has `AGENTS.md` and lacks `CLAUDE.md`. The repository's need for a separate guide is unknown. |
| ESLint #3 | Confirmed correct | Root `.npmrc` is an unignored credential-store filename. Content and tracking intent are separate questions. |
| ESLint #4 | Confirmed correct | `tests/fixtures/config-file/broken-package-json/package.json:7` fails static JSON parsing. The informational wording identifies fixture scope. |
| ESLint #5 | Confirmed correct | `tests/fixtures/ignored-paths/broken-package-json/package.json:10` is a distinct malformed fixture. |
| Filament #1 | Confirmed false positive | The export omits `.gitignore` but the [pinned Git tree contains it](https://github.com/filamentphp/filament/blob/9d78093cfebdc96c077b1d8dbf94b41738f28992/.gitignore). The original recommendation would be wrong for the checkout. |
| Filament #2 | Confirmed correct | Root `.npmrc` is present and unignored in the materialized export. |
| Filament #3 | Confirmed correct | `docs-assets/app/.env` is an environment filename under docs assets. Scope is the export, which omits the root ignore file. |
| Filament #4 | Confirmed correct | `docs-assets/app/.npmrc` is the app's own configuration filename. |
| Filament #5 | Confirmed correct | `docs-assets/screenshots/.npmrc` is separate from the app configuration. |
| Laravel #5 | Confirmed correct | Root `.npmrc` is an unignored credential-store filename. No contents were reviewed. |
| OpenAI Python #2 | Confirmed correct | `tests/fixtures/mtls/client-chain.pem` is a matching certificate path used by `tests/test_mtls_http_client.py:19`. The fixture purpose is documented. |
| OpenAI Python #3 | Confirmed correct | `tests/fixtures/mtls/client.key` is referenced at `tests/test_mtls_http_client.py:20`. File-name cue only. |
| OpenAI Python #4 | Confirmed correct | `tests/fixtures/mtls/root.pem` is the root-certificate fixture referenced at `tests/test_mtls_http_client.py:21`. |
| OpenAI Python #5 | Confirmed correct | `tests/fixtures/mtls/server-chain.pem` is the server certificate chain referenced at `tests/test_mtls_http_client.py:22`. |
| OpenAI Python #6 | Confirmed correct | `tests/fixtures/mtls/server.key` is the server key fixture referenced at `tests/test_mtls_http_client.py:23`. File-name cue only. |
| PHPStan #4 | Confirmed false positive | `turbo-ext/CLAUDE.md:626–629` explicitly identifies both paths as vendored parser source. Local absence is expected. |

Totals are **23 confirmed correct, three confirmed false positives, two
ambiguous, zero unsupported and zero duplicate**. The filename notes are
distinct observations, including the TLS fixtures. This audit does not add
these observations to the frozen scoring denominator. The two scope false
positives were suppressed by the review fixes. The Filament export still
receives a scan-scoped note with a qualified recommendation.

## Redaction and filesystem verification

The review traced paths through the walker, safe reader, diagnostic producers,
analysis objects and CLI text/JSON rendering. The manifest writer still receives
the actual root for its write-boundary check. Existing tests cover symlink
escape and replacement, sensitive paths, identifier and error redaction,
read limits and read-only behavior. No repository code is executed. The
documented concurrent parent-directory and hard-link limitations remain.

The new excerpt test checks CRLF source with a multiline private-key fixture,
a second secret on the same line as a stale reference, malformed UTF-8, invalid
JSON, an astral Unicode character at the truncation boundary and a standalone
carriage return. It compares text and decoded JSON, verifies the original
evidence lines and compares a digest of the scanned tree before and after.
The output contains at most four excerpts per finding, up to 120 code points
each before CLI ASCII escaping. Recognised secret-bearing lines are omitted.
Agents using their own file tools operate outside this boundary.

## Installation reproduction

```sh
npx --yes skills@1.7.6 add https://github.com/AVL05/contextanvil/tree/37b10b97a52c8dbc4dd2f11580759a84e39afb77/skills/contextanvil --agent claude-code codex --skill contextanvil --copy --yes
```

Run in a disposable project. No global settings are required. For each of
the two installed Skill directories, compare every installed file against
`git ls-tree -r <commit> skills/contextanvil` using `git hash-object --no-filters`.
All 44 blobs matched at both destinations. The candidate engine tree was
`d407bc662215077298c731984b5530498aa08d94`.

The published 1.7.6 bundle's `parseSource` reads the `@suffix` in shorthand
as a skill filter. Only a fragment ref populates the Git ref in that shorthand.
The explicit `--skill contextanvil` selection overrode the suffix filter,
so the resolver cloned the default branch. The source banner alone is
misleading. Repeating the shorthand installed the main branch's CLI blob
`8900696e9ae33ae39ea64c2b82cc10a4f4e8f00d`, while the tree URL installed
`ba8bc8a29befdb40a11eeddfc3fccacb92db9306` from the requested commit.

## Agent smoke tests

On Windows, Claude Code 2.1.318 and standalone Codex CLI 0.166.0 both
activated the installed Skill implicitly and explicitly at the exact
`37b10b97` revision. Each launcher returned the expected missing script
and path at `AGENTS.md:3` and `AGENTS.md:4`. With installer 1.7.6, both
launchers were also installed from a local Git archive at the corrected
runtime revision `e1b7e230`. All 44 blobs at each destination matched that
commit. A fresh explicit session in each client returned the same evidence.
The corrected fixture's input file hashes were unchanged afterwards.

Claude kept normal tool permissions with a launcher-specific approval.
Standalone Codex ran with `--sandbox read-only` and no desktop routing
variables in the child process. The previously observed desktop-inherited
Windows process-launch failure remains a separate, unsupported setup.
No global settings or sandbox permissions were changed. These were Windows
smoke tests on a synthetic fixture. They do not measure activation rates.

## Regression verification and decision

The corrected runtime replay retained the frozen counts of four true
positives, zero false positives, two frozen false negatives and 36 true
negatives. The two frozen misses remain the previously documented label
errors. Total findings dropped from 43 to 41 and unmatched findings from 28
to 26. The two path false positives are absent, and the genuine Cloudflare
and PHPStan stale findings remain. The archive-scoped Filament note is
still present.

The [paired profiler](../../bench/doctor/profile.js) ran seven measured
pairs after warm-up on Node 24.22.2 for the original candidate and the
corrected runtime. These are host-specific medians, not latency guarantees.

| Input | Latency, original → corrected | Peak RSS, original → corrected |
| --- | ---: | ---: |
| Next.js fixture | 22.2 → 22.4 ms | 55.3 → 55.3 MiB |
| Cloudflare Agents export | 298.9 → 298.8 ms | 75.0 → 76.2 MiB |
| PHPStan export | 479.1 → 474.3 ms | 79.1 → 79.1 MiB |

The local suite ran 166 tests with 163 passes and three platform skips.
The generated Skill matched the engine. No runtime dependencies changed.

- **Merge readiness.** The confirmed engineering defects above are corrected.
  The pull request can proceed through human review and green CI.
- **Holdout readiness.** Proceed with independent blind labeling and
  adjudication. Execute the holdout only after labels, gates and the candidate
  are locked. See the [independent protocol](doctor-holdout-protocol.md).
- **Release readiness.** Unverified pending independent holdout results.
  The historical corpus is too small and disclosed to provide release-level
  accuracy estimates.
