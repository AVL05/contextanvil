# Doctor detector coverage

Audited baseline: [c8b2624](https://github.com/AVL05/contextanvil/tree/c8b2624b743902db0cdbd9f3eeb5ee91b85aa2bb).
The CLI scans files, then [`diagnose()`](../../src/doctor.js) evaluates scanner
documents, facts, diagnostics and sensitive filenames. The 43 IDs below include
the nine suffixes of `suspicious-instruction:*` as distinct IDs.

## Coverage matrix

Test references use D = [doctor](../../test/doctor.test.js), S =
[security](../../test/security.test.js), T = [detectors](../../test/detectors.test.js).
Traversal and read-limit producer tests are in [scanner safety](../../test/scanner-safety.test.js).
“Producer” means regression coverage of the upstream scanner behavior, with no
dedicated Doctor output assertion identified. A dash means no direct targeted
assertion identified in those suites.

| Category | Finding ID | What triggers it | Default | Evidence and limitation | Regression |
| --- | --- | --- | --- | --- | --- |
| missing | `no-agent-instructions` | No readable recognized instruction document in the scan | warning | No anchor. Ignored, unreadable and unsupported files can look absent. | D missing instructions |
| missing | `agents-without-claude` | Any AGENTS.md and no exact CLAUDE.md | info | First AGENTS.md path. No client requirement or matching scope check. | D hygiene negative |
| missing | `claude-without-agents` | Any exact CLAUDE.md and no AGENTS.md | info | First CLAUDE.md path. CLAUDE.local.md alone does not qualify. | — |
| missing | `instruction-empty` | Fewer than 80 nonblank, nonheading characters | warning | Document path. Short imports and scoped overrides count as sparse. | D hygiene |
| missing | `instruction-large` | Estimated 4,001–8,000 tokens | info | Document path. Estimate is ceil(bytes/4), irrespective of tokenizer or scope. | — |
| missing | `instruction-oversized` | Estimated more than 8,000 tokens | warning | Document path. Same estimate, with no measured effect on the agent. | D hygiene |
| missing | `instructions-omit-test` | First root Node test-role script lacks a matching root command or literal body | info | Script declaration path/line. No canonical script selection or equivalent workflow reasoning. | D healthy repo indirectly |
| missing | `instructions-omit-build` | First root Node build-role script lacks a matching root command or literal body | info | Script declaration path/line. A secondary script may be selected. | D healthy repo indirectly |
| conflict | `conflicting-package-managers` | More than one of npm, Yarn, pnpm and Bun in recognized inline/fenced command segments | warning | First matching line for each manager per nonsymlink doc. Mixes scopes and intentional alternatives. | D contradictions and prose guard |
| conflict | `instruction-lockfile-mismatch` | One mentioned manager differs from one root manager fact | warning | First command line and fact source path. Skipped when multiple managers are mentioned. | D contradictions |
| conflict | `multiple-lockfiles` | Root lockfiles for multiple Node managers with a parsed root manifest | warning | Path of first lockfile. Intentional coexistence may be legitimate. | T lockfiles producer |
| conflict | `package-manager-mismatch` | Root packageManager is absent from the manager set inferred from existing root lockfiles | warning | Root package.json path. If any lockfile agrees, this alert is suppressed. | — |
| conflict | `duplicate-instructions` | Identical content digest among nonsymlink docs | info | All group paths. Does not check generated copies, intent or near-duplicates. | D hygiene |
| stale | `missing-script-reference` | Named npm, Yarn, pnpm or Bun script-like command in a root instruction has no matching root script | warning | First command line per name/document. No working directory, workspace resolution, conditional example or shell semantics. Up to 40 string script facts. | D outdated references and prose guard |
| stale | `missing-path-reference` | Inline code or Markdown link outside fences resembles a missing slash-containing file or directory | warning | First qualifying path line per document, capped at 15. Checks root, doc-relative and partial indexed paths. Excludes many placeholders, output paths, URLs, bare filenames, globs and extensionless filenames. | D outdated references and partial paths |
| stale | `entrypoint-missing` | Missing root Node main/module, supported exports/bin, or simple start/dev target | warning | Manifest path and approximate field line. Skips globs and known output dirs; generated targets elsewhere can trigger. | D entrypoint, T producer |
| unsafe | `secret-in-instructions` | Secret matcher detects a probable credential | error | Document path/line, value omitted. Pattern detection cannot validate authenticity or completeness. | D secret redaction, S output redaction |
| unsafe | `terminal-control-characters` | Neutralizer sees terminal controls | warning | Up to five distinct document lines. Character presence does not establish intent. | S terminal controls |
| unsafe | `hidden-characters` | Neutralizer sees invisible or direction-changing characters | warning | Up to five distinct document lines. Some multilingual uses are intentional. | D hidden characters, T producer |
| unsafe | `suspicious-instruction:ignore-instructions` | Override language near a reference to prior instructions | warning | Matched document line. Local clause negation guard; no scope or intent parsing. | D hijacking, S phrases |
| unsafe | `suspicious-instruction:reveal-secrets` | Disclosure verb near a secret or system-prompt term | warning | Matched line. Local clause negation guard; no validation of data flow. | D hijacking, S phrases |
| unsafe | `suspicious-instruction:hide-from-user` | Negative imperative about informing the user | warning | Matched line. Legitimate privacy instructions can qualify. | D hijacking, S phrases |
| unsafe | `suspicious-instruction:skip-confirmation` | “Without” near approval/confirmation terms | warning | Matched line. Local clause negation guard; intent is heuristic. | D hijacking/benign, S phrases |
| unsafe | `suspicious-instruction:disable-safety` | Bypass/disable language near security-control terms | warning | Matched line. Local clause negation guard. | S phrases |
| unsafe | `suspicious-instruction:role-override` | Selected role prompts, delimiters or role labels | warning | Matched line. Examples and fixtures can qualify. | S phrases |
| unsafe | `suspicious-instruction:exfiltrate-to-url` | Transfer verb, sensitive object and literal URL in sequence | warning | Matched line. Cannot reason about destinations, indirection or authorization. | S phrases |
| unsafe | `suspicious-instruction:pipe-to-shell` | Literal curl/wget pipe into recognized shell | warning | Matched line. Does not follow command substitution, script downloads or subsequent commands. | D hijacking, S phrases |
| unsafe | `suspicious-instruction:encoded-execution` | Literal base64 decoding piped to a recognized shell | warning | Matched line. No payload decoding or multi-command data flow. | S phrases |
| unsafe | `hidden-comment` | Same-line HTML or Markdown reference comment meeting text thresholds | info | Comment line. No semantic analysis or multiline HTML detection. | D hidden comments, S hidden content |
| unsafe | `hidden-html-element` | Inline hidden attribute or selected CSS hiding declarations | warning | Matched line. No DOM/CSS evaluation. | S hidden content |
| unsafe | `encoded-payload` | Base64-like run of at least 300 characters | info | Matched line. Does not validate encoding or contents. | S hidden content |
| unsafe | `sensitive-file-not-ignored` | Unignored filename recognized as sensitive | warning | Path, no file read. Does not prove tracking or exposure; ignoring an already tracked file does not untrack it. | D sensitive files, S producer |
| unsafe | `no-gitignore` | No root .gitignore in index | info | No anchor. Other ignore layers may suffice. | D sensitive files |
| unsafe | `install-time-script` | Node preinstall/install/postinstall/prepare or recognized Composer install/update/autoload events | info | Manifest script path/line. Execution depends on command, package role and flags; automatic does not imply malicious. | D entrypoint (Node), T script safety |
| unsafe | `agent-executable-config` | Recognized agent JSON has hook/server key text or an MCP config suffix | info | Config path. No parsing or validation that a command exists. | D hooks/MCP |
| scan | `malformed-json` | A detector cannot parse a manifest/config as expected JSON | warning or error | Diagnostic path/line if available. Only parsed inputs are checked. | S safe diagnostics producer |
| scan | `instruction-unreadable` | Recognized indexed instruction fails the safe reader | warning | Document path. May accompany other diagnostics for the same read. | — |
| scan | `file-limit` | Walker hits the file index limit | warning | Usually no path. Subsequent absence claims may be incomplete. | Walker limits tests |
| scan | `depth-limit` | Walker skipped directories beyond the depth limit | warning | No path. Summarizes skipped directories. | — |
| scan | `symlink-escape` | Walker or reader identifies a target outside the root | warning | Symlink path. Availability and semantics can vary by OS. | S escaping symlink producer |
| scan | `unreadable-directory` | Traversal cannot read a directory | warning | Directory path. Coverage inside it is unknown. | — |
| scan | `file-too-large` | A requested read exceeds byte limits | warning | Path. Does not list all large indexed files. | Scanner safety producer |
| scan | `detector-failed` | A detector threw an exception | error | Usually no path. Other detector output may still be present. | — |

## Supported inputs and interpretation

- **General.** Recognizes AGENTS.md, CLAUDE.md/CLAUDE.local.md and GEMINI.md at
  any depth, plus root-anchored Copilot, Cursor and legacy Windsurf patterns.
  Nested instructions are directory-scoped except for the special Copilot and
  Cursor paths. There is no general import graph, glob scope resolution or
  precedence model. Root-only script checks and repo-wide manager checks use
  different notions of scope. Safety and path checks apply across recognized docs.
- **JavaScript/TypeScript.** Root package.json, recognized Node lockfiles and a
  capped root script inventory supply most command checks. React and Next.js are
  scanner facts, with Next route structures detected by convention. Neither has
  additional Doctor rules for framework-specific instructions. Workspaces are
  visible in the file tree but are not a command-resolution model.
- **PHP/Laravel.** Scanner reads root composer.json and recognizes Laravel
  layout and scripts. Doctor surfaces recognized Composer lifecycle events and
  generic checks. It does not cross-check Composer/Artisan commands or validate
  Composer autoload targets the way it validates Node entry points.
- **Python, Go, Rust.** General document, path, safety and scan checks apply, as
  can Node rules if a root package.json coexists. No native dependency-manager,
  task, package, version or entry-point validation for these ecosystems.

Evidence is generally a repository-relative path and a one-based line where a
heuristic or scanner producer can locate one. A negative whole-repo claim can
have no evidence entry. There is no structured confidence field in Doctor
schema v1. Two stale rules describe themselves as medium-confidence in their
detail. Scanner fact confidence is separate; the root Node manifest gate
excludes low-confidence facts. Severity drives `--fail-on`, and does not quantify
probability. Findings are deduplicated by ID, title and ordered anchors, then
sorted by severity, category, ID, title and first anchor.

The safe reader uses ignore rules, symlink containment, indexing and read caps.
The default file/depth/per-file/total-read bounds are 20,000 files, 25 levels,
512 KiB and 64 MiB. There are scanner diagnostics outside Doctor's allowlist.
The security and scan tests verify safety properties on fixtures. They do not
measure diagnostic accuracy on public repositories.
