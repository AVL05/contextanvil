# Security model

ContextAnvil reads repositories you may not fully trust and produces text that is fed to AI agents.
This document states what it guarantees, how, where the guarantees end, and what the Phase 1.1 review found.
To report a vulnerability, see `SECURITY.md`.

## Guarantees

| Property | How it is enforced |
| -------- | ------------------ |
| Read-only analysis | Tests hash fixture trees before and after analysis. Explicit `manifest create` and `manifest update` publish only outside the scanned root. Filesystem writes are confined to `src/manifest/storage.js`. |
| No execution of repository code | There is no `child_process`, `eval`, `new Function` or dynamic `import()` of scanned content. npm and Composer scripts, and JavaScript/PHP config files, are recorded as text only. |
| No network | The code makes no network calls and has no dependencies that could. Nothing is transmitted. |
| Bounded work | Limits on file count, depth, entries per directory, per-file size and total bytes read (configurable). Every regular expression applied to repository text is bounded, and ignore patterns are matched without compiling them to regular expressions. Hitting a limit is reported. |
| No traversal or symlink escape | Directory symlinks are never followed. File symlinks are indexed only if their real target is inside the root. Ignore files are read only if they are regular files inside the root. The reader serves only indexed paths and re-checks the real path before opening. References quoted in repository text are normalised and never used to read files outside the index. |
| Narrowed check/use window | Files are opened with `O_NOFOLLOW` where the platform has it, and after opening, the descriptor's device/inode and the path's real location are verified again. |
| Secrets are not read or printed | Sensitive file names (`.env*`, keys, credential stores, tfstate, `auth.json`, ...) are never opened. Text that is shown (instruction excerpts, script commands, evidence, fact payloads, the task itself) passes through `redact()`. Diagnostics report secret *type and line*, never the value. |
| Repository text is data | Instruction excerpts are blockquoted with source, line range and digest, and labelled as untrusted. Control characters (including terminal escape sequences) and invisible or direction-changing Unicode characters are replaced with visible `<U+XXXX>` markers in every output. File names containing such characters are not indexed. Nothing in scanned text can alter ContextAnvil's behaviour. |
| Errors do not echo content | Parse failures report a location, never text. Read failures report a code and a path, never the operating-system message. Unexpected errors print only the error class unless `CONTEXTANVIL_DEBUG` is set. |
| No side effects on agent configuration | It never installs hooks, edits agent settings, or overwrites instruction files. |
| Deterministic | Same input, same bytes of output. |

## What `doctor` flags as potentially unsafe

- secrets in instruction files (an error);
- terminal control characters, and invisible or direction-changing characters, in instruction files;
- text hidden from reviewers: HTML comments, Markdown link-reference comments, HTML elements hidden with `display:none`
  or `hidden`, and long encoded-looking strings;
- phrases that try to steer an agent against its user: ignoring prior instructions, hiding actions from the user,
  skipping confirmation, disabling safety checks, role-override markers (`<system>`, `[INST]`, "you are now
  unrestricted"), exfiltrating secrets or the environment to a URL, piping downloads into a shell. A negation in the
  same clause ("never ignore previous instructions", "do not push without review") suppresses the finding;
- sensitive files not covered by ignore rules; install-time scripts; agent hook and MCP server configuration that can
  run commands.

These are heuristics for human review. They do not prove malice or safety.

## Phase 1.1 security review: findings and fixes

All items were found by review or by measuring adversarial inputs against v0.1.0, and fixed in v0.1.1 with regression
tests in `test/security.test.js`.

| # | Finding in v0.1.0 | Severity | Evidence | Fix |
| - | ----------------- | -------- | -------- | --- |
| 1 | **Catastrophic regex backtracking in secret detection.** A 200 KB instruction file made of `a.a.a.` ..., or of the text `api_key` repeated, or `a.a.` repeated before `://`, hung `redact()` / `findSecrets()` (each took longer than 15 s, the probe's limit). | High (denial of service by a hostile repository, within the default 512 KiB file limit) | measured | Rewrote the patterns with bounded quantifiers, quick substring pre-checks and a line-offset index. |
| 2 | **Catastrophic backtracking in `.gitignore` matching.** Patterns were compiled to regular expressions, so `*a*a*a*a*a*a*b` took 3.2 s against a 60-character name and did not finish with 10 stars. A hostile `.gitignore` could hang any scan. | High | measured | Replaced with a segment-wise iterative glob matcher; overlong or over-deep patterns are skipped. |
| 3 | Terminal escape sequences in repository text (instruction files, script commands, file names) were printed raw, so a repository could rewrite what the user sees. | Medium | review | `sanitize.js` neutralises control and invisible characters in all fact fields and excerpts; file names containing them are not indexed; `doctor` reports them. |
| 4 | Fact `data` payloads were not redacted, so a dependency range such as `git+https://user:token@host/...` appeared in JSON output. | Medium | review | All strings in fact payloads, claims and evidence are redacted and neutralised. |
| 5 | `.gitignore` / `.contextanvilignore` were read through `statSync`/`readFileSync`, which follow symlinks, so an ignore file symlinked to a file outside the root was read. | Low (content only influenced ignore rules) | review | Ignore files are read only when their real path is inside the root. |
| 6 | Check-then-open race in the reader: a path could be swapped for a symlink between the root check and `open`. | Low (needs a concurrent local attacker) | review | `O_NOFOLLOW` plus post-open identity and location checks. Narrowed, not eliminated (see below). |
| 7 | A directory with millions of entries was listed fully into memory before any limit applied. | Low | review | Directory listing aborts above `maxDirEntries` (default 20,000) and the directory is skipped and reported. |
| 8 | Credential file coverage was thin (`auth.json`, `.envrc`, `.dev.vars`, `.yarnrc.yml`, `.pgpass`, `*.p8`, `secrets/` directories were read). | Low | review | Added to the sensitive-path rules. |
| 9 | Prompt-injection heuristics covered only six phrase families, and flagged *prohibitions* ("do not ... without explicit approval") as attacks. | Low (accuracy) | found while validating on real repositories | Added role-override, safety-disabling, exfiltration and hidden-content checks; negation in the same clause suppresses a finding. |
| 10 | `compileContext` retained a lower-cased copy of every analysed file (worst case a few hundred MB; an estimate, not measured). | Low | review | Only per-term counts are kept; text is not retained. |

Checked and found sound: no use of `eval`, `child_process`, dynamic import, network or filesystem writes in `src/`;
prototype-pollution attempts through manifest keys (`__proto__`, `constructor`) and 100,000-level-deep JSON do not crash
or alter behaviour (tested); error messages and diagnostics do not contain file contents (tested).

## Known limitations (residual risk)

- **Time-of-check/time-of-use is narrowed, not closed.** A concurrent local attacker who swaps a *parent directory*
  for a symlink between the checks and the read might still redirect a read. Node.js offers no portable `openat`-style
  confinement. Do not scan a directory that an untrusted process is modifying while the scan runs.
- **Hard links** to files outside the repository cannot be distinguished from ordinary files.
- **Secret detection is heuristic.** It targets common token formats and credential-like assignments, and will miss
  unusual formats and flag harmless strings. Treat redaction as defence in depth, not a guarantee.
- **Only some files are examined for secrets**: instruction files, manifests and other text that reaches output.
  `doctor` is not a general secret scanner; use a dedicated tool for that.
- **Hijacking-phrase detection is narrow, English-only and evadable.** The mitigation that matters is structural:
  ContextAnvil never obeys repository text, and the agent consuming the pack sees excerpts labelled as quoted project
  content. Agents themselves may still be influenced by such text. Review instruction files in repositories you did not
  write. Homoglyph (look-alike character) tricks are not detected.
- **Resource use has limits but no deadline.** A repository at the default limits can use tens of seconds of CPU and
  on the order of 100 MB of memory (measured: 97 MB peak for 5,000 generated files). There is no wall-clock timeout;
  scanning is synchronous and cannot be interrupted from inside the library.
- **Ignore handling** covers `.gitignore` and `.contextanvilignore` files inside the tree. It does not read
  `.git/info/exclude` or the global excludes file.
- **Default exclusions** (`vendor`, `dist`, `build`, `out`, and so on) are applied by directory name regardless of
  content.
- **Filename protection is pattern-based.** Credential-shaped names are skipped with a location-free diagnostic,
  including unsafe in-tree link targets. Names containing secrets outside the recognized patterns can still appear.
- **Sensitive-file rules are name-based.** A credential stored in an innocuously named file is not recognised as
  sensitive. Detectors only open the manifests, configuration and instruction files they know about, but a
  pasted secret inside one of those is redacted by pattern, not by knowledge.
- **An agent can still read secrets itself.** The engine masks recognized secret patterns, and the Skill tells the agent not to
  open, search or print lines flagged as secrets. That is an instruction, not an enforcement: in testing, 1 of 5 Claude Code
  runs read the flagged line with its own file tool (without repeating it in its answer). If a secret must stay out of an
  agent's context, remove it from the repository. Details: [skill.md](skill.md#known-issue-found-during-final-review).
- **Generated context goes to whatever you send it to.** ContextAnvil does not transmit it; what an agent or
  provider does with it is outside this tool's control.
- **Not independently audited.** This review was done by the author of the code.
