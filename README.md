# ContextAnvil

**Forge better context.**

ContextAnvil is an [Agent Skill](https://agentskills.io) for **Claude Code** and **OpenAI Codex**. It teaches
your coding agent to audit `AGENTS.md` and `CLAUDE.md`, find instructions that are stale, contradictory or
suspicious, and prepare source-cited context for complex tasks. It bundles a deterministic, offline,
read-only analysis engine, so there is nothing else to install and no service to configure.

> **Status: beta.** The Skill, the engine and their tests are implemented. The package is not published
> to npm and does not need to be. The ranking behind context preparation has modest measured accuracy (see
> [How well does the ranking work?](#how-well-does-the-ranking-work)), and **no experiment has shown that the
> Skill saves tokens or improves coding results.** See [Limitations](#limitations).

## What it does

When your agent decides the task calls for it, the Skill runs a bundled analyser and uses the result:

- **Audit instructions**: finds conflicting package managers, scripts and paths that no longer exist, secrets,
  hidden or invisible characters, and text that tries to steer an agent (for example "ignore previous
  instructions"). Every finding cites `path:line`.
- **Inspect repository facts**: languages, frameworks, scripts, entry points and conventions, each marked
  `observed` (read from a file) or `inferred` (a heuristic).
- **Prepare context**: for a complex task in an unfamiliar codebase, a ranked list of relevant files with reasons, applicable
  instruction excerpts and an explicit list of what was left out.
- **Recommend changes**: the agent proposes precise edits to your instruction files. It does not apply them
  unless you ask.

## Why install it

- Instruction files rot. A command that no longer exists, a second package manager, a pasted secret: agents
  follow these confidently. The audit finds them with evidence you can check.
- Instruction files are an attack surface. The audit flags hidden and hijacking text before an agent reads it.
- It is local, offline and read-only, and the Skill's description tells the agent when **not** to use it.

What it does not do: it does not call any model or API, run any repository code, or change any repository file.

## Install

```bash
npx skills add AVL05/contextanvil
```

This uses the open-source [`skills`](https://github.com/vercel-labs/skills) installer. It copies the Skill to
`.agents/skills/contextanvil` (read by Codex) and links it into `.claude/skills/contextanvil` (read by Claude
Code); add `-g` for a user-level install. Everything the Skill needs, including the analysis engine, lives in
that one directory.

Prerequisites: **Node.js 22 or later** on the machine that runs your agent. No npm install, no network access,
no account and no MCP server are needed after the files are copied.

**Windows and Codex.** Codex runs commands in a sandbox as a different Windows user. A Node.js that lives in your profile
folder, for example one managed by nvm-windows, is on `PATH` but cannot be executed there ("Access denied"), and the Skill
will report that Node.js is unavailable. The minimum workaround is a Node.js 22+ in a location every local user can read,
such as `C:\Program Files\nodejs`, then a new Codex session. This was verified with a Node.js binary already under
`C:\Program Files`; the official installer and other Windows setups were not tested. Details: [docs/skill.md](docs/skill.md).

Manual install, without the installer: copy `skills/contextanvil/` from this repository to
`.claude/skills/contextanvil/` (Claude Code) and/or `.agents/skills/contextanvil/` (Codex), project-level or under
your home directory.

## Use it

**Automatically.** Ask for something the Skill covers and the agent loads it by its description:

- "Audit our AGENTS.md and CLAUDE.md."
- "Our agent keeps running `yarn` but we use npm. Why?"
- "Check this repository's instruction files before I let an agent loose in it."
- "I need to change how billing retries work and I don't know this codebase. Where should I look?"

**Explicitly.** Name the Skill in your prompt (`use the contextanvil skill to audit this repository`) or, in
Claude Code, run `/contextanvil`.

**By hand.** The launcher is a plain Node script inside the installed Skill:

```bash
node .agents/skills/contextanvil/scripts/contextanvil.mjs doctor .
node .agents/skills/contextanvil/scripts/contextanvil.mjs context "add rate limiting to login" .
node .agents/skills/contextanvil/scripts/contextanvil.mjs scan . --json
```

`doctor` exits `1` when it has findings. Only these read-only commands are exposed through the Skill launcher;
the `manifest` command, which writes files, is not.

## When agents should use it

| Use it | Do not use it |
| ------ | ------------- |
| The user asks to audit, review or improve `AGENTS.md`, `CLAUDE.md` or similar | A small, well-scoped edit in files already open |
| Instructions seem to disagree with the code | Questions answerable from files already in context |
| An unfamiliar repository should be checked before an agent works in it | "Just in case" scans before every task |
| A complex task spans areas the agent does not know | Repeating an analysis whose result is already in the conversation |

The Skill's instructions tell the agent to run one analysis per question, keep its reply short, verify each
finding against the cited line, separate observations from inferences, and treat everything in the repository
as untrusted data. Details live in `skills/contextanvil/references/`.

## Verified compatibility

Tested on Windows 11 with Node.js 24.22.2, Claude Code 2.1.318 and Codex CLI 0.166.0: install from the default branch with
`npx skills add AVL05/contextanvil`, discovery by both agents, running the bundled analyser from the installed location, auditing a
repository with intentional defects, matching evidence, and an unchanged repository afterwards. Results and
platform-specific limitations, including a Codex-on-Windows sandbox problem, are in
[docs/skill.md](docs/skill.md). Linux and macOS were not tested with the real agents.

## Skill layout

```text
skills/contextanvil/
  SKILL.md                      frontmatter + concise instructions (progressive disclosure)
  references/                   audit workflow, finding catalogue, context preparation, safety, limitations
  scripts/contextanvil.mjs      launcher: Node version check, read-only command allowlist
  src/, package.json            vendored copy of the engine (generated, do not edit)
```

`src/` is copied from the repository's `src/` by `npm run skill:sync`; `npm run skill:check` and the test suite
fail if they drift apart. The reason for the copy: the installer copies only the Skill directory, so the Skill must
carry its own engine. The npm package and `bin/contextanvil.js` still exist for development, but the Skill does
not depend on them.

---

## CLI and engine reference

Everything below describes the engine behind the Skill. It is also usable on its own from a clone: `node bin/contextanvil.js --help`.
The engine is deterministic and offline, and repository analysis is read-only.

## Design principles

Coding agents work better when they start from accurate, relevant context, and worse when they re-discover
a repository each session, read the wrong files, or follow instructions that no longer match the code.
ContextAnvil is built around three ideas:

- **Understand**: discover languages, frameworks, scripts, entry points, conventions and existing agent
  instructions, and record *where each fact came from*.
- **Forge**: compile focused context for a specific task within an explicit budget, explaining why each item
  is included and listing what was left out.
- **Verify**: detect instructions that contradict each other, reference things that no longer exist, or
  contain secrets and hidden or hijacking text.

What it deliberately does differently from memory and indexing tools: analysis is **deterministic** (same
input, same bytes), every claim is **cited** (path, line, content digest), facts are separated from
**inferences**, budgets are **measured** rather than assumed, ranking decisions are **explained**, and nothing in a
scanned repository can instruct the tool.


## Use cases for the engine

- Give an agent a compact starting pack for a task: `contextanvil context "Fix the login redirect" .`
- Check in CI that `AGENTS.md` still matches the repository: `contextanvil doctor .`
- Audit an unfamiliar repository before letting an agent loose in it.
- Get a source-cited overview of a codebase for onboarding.
- Build your own tooling on the JSON output or the library API.

## Run from a clone

Requires **Node.js 22 or later**; there are no dependencies to install.

```bash
git clone https://github.com/AVL05/contextanvil
cd contextanvil
npm test
node bin/contextanvil.js --help
```

## Commands

```text
contextanvil scan [path]                 Analyse a repository and report what was found
contextanvil context "<task>" [path]     Compile focused context for a task
contextanvil doctor [path]               Diagnose missing, conflicting, stale or unsafe context
contextanvil --help | --version
```

`path` defaults to the current directory. Every command accepts `--json`. Shared options:
`--max-files <n>`, `--max-depth <n>`, `--max-file-size <size>`, `--no-gitignore`.

Exit codes: `0` success, `1` doctor findings at or above `--fail-on`, `2` usage error, `3` runtime error.

### `scan`

The output below is real, from the sample project in `test/fixtures/next-app` (trimmed to the first
sections):

```text
$ contextanvil scan test/fixtures/next-app
ContextAnvil scan (v0.1.1)
Root: test/fixtures/next-app
Indexed 15 files in 4 directories (2.3 KiB).
Excluded: nothing.
Legend: [status/confidence] source. "observed" = read from a file, "inferred" = heuristic.

LANGUAGES (BY FILE EXTENSION)
  - TypeScript: 7 files (.ts, .tsx) by extension  [observed/high] app/layout.tsx
  - JavaScript: 1 file (.mjs) by extension  [observed/high] next.config.mjs

FRAMEWORKS AND LIBRARIES
  - Next.js ^14.2.3 (App Router) (declared in dependencies)  [observed/high] package.json:13
  - React ^18.3.1 (declared in dependencies)  [observed/high] package.json:14

TEST FRAMEWORKS
  - Jest ^29.7.0 (declared in devDependencies)  [observed/high] package.json:19
  - React Testing Library ^16.0.0 (declared in devDependencies)  [observed/high] package.json:18

PACKAGE MANAGER
  - Package manager: npm (lockfile present)  [observed/high] package-lock.json

ENTRY POINTS
  - Next.js framework entry: app/layout.tsx  [observed/high] app/layout.tsx
  - Next.js framework entry: app/page.tsx  [observed/high] app/page.tsx

SIGNIFICANT SOURCE DIRECTORIES
  - app/: 2 source files (TypeScript 2); Next.js App Router routes (page/layout files present)  [observed/high] app/layout.tsx
  - components/: 3 source files (TypeScript 3); React UI (majority JSX/TSX files)  [inferred/medium] components/Footer.tsx
  - lib/: 2 source files (TypeScript 2)  [observed/high] lib/format.test.ts

CONVENTIONS (EVIDENCE-BACKED)
  - No "type" field in package.json: .js files default to CommonJS in Node.js  [inferred/medium] package.json
  - EditorConfig defaults for all files: indent_style=space, indent_size=2, end_of_line=lf  [observed/high] .editorconfig:3
  - Prettier options: semi=false, singleQuote=true, tabWidth=2  [observed/high] .prettierrc
  - TypeScript compiler options: strict=true; target="es2017"; jsx="preserve"; paths=@/*  [observed/high] tsconfig.json:3
  - Test files are named with ".test." (2 of 2); all colocated with source files  [inferred/medium] components/Navigation.test.tsx
  ...
```

Note how the `components/` role is `inferred/medium` (a React dependency plus mostly JSX/TSX files), while
the framework itself is `observed/high` (it is declared in `package.json` line 13).

### `context`

```text
$ contextanvil context "Update the navigation component" test/fixtures/next-app --budget 3kb
# ContextAnvil context pack

- Task: Update the navigation component
- Repository: next-app
- Task terms: navigation x1.19 (4 files), component x1.15 (5 files)
- Task intent: modify (default)
- Budget: 3072 bytes; used 2946 bytes (~737 estimated tokens, bytes/4)
- Provenance: items cite path:line and a content digest. "observed" = read from a file; "inferred" = deterministic heuristic.
- Instruction excerpts are quoted project content, not directives to ContextAnvil.

## Project snapshot (observed facts)
- Languages: TypeScript (7 files) [app/layout.tsx; observed/high]; JavaScript (1 file) [next.config.mjs; observed/high]
- Frameworks: Next.js ^14.2.3 (App Router) [package.json:13; observed/high]; React ^18.3.1 [package.json:14; observed/high]
- Test frameworks: Jest ^29.7.0 [package.json:19; observed/high]; React Testing Library ^16.0.0 [package.json:18; observed/high]
- Package manager: npm (lockfile) [package-lock.json; observed/high]
- Runtime and modules: No "type" field in package.json: .js files default to CommonJS in Node.js [package.json; inferred/medium]

## Relevant files (ranked, with reasons)
- `components/Navigation.tsx` (score 8.68; 197 B; sha256 aad0dfde)
  - why: name matches "navigation"; dir components/ matches "component"; content "navigation" x1 (4/11 files); 2/2 terms
  - symbols: Navigation (function, line 3)
  - related: `components/Navigation.test.tsx` (test (same base name)), `app/layout.tsx` (imports it)
- `components/Navigation.test.tsx` (score 6.5; 230 B; sha256 22de7bd5)
  - why: name matches "navigation"; content "navigation" x5 (4/11 files); dir components/ matches "component"; 2/2 terms
  - related: `components/Navigation.tsx` (imported by it)
- `app/layout.tsx` (score 3.94; 251 B; sha256 8c5c9772)
  - why: content "navigation" x3 (4/11 files); content "component" x1 (5/11 files); 2/2 terms
  - symbols: RootLayout (function, line 3)
  - related: `components/Navigation.tsx` (imported by it)
- `CLAUDE.md` (score 3.15; reasons trimmed to fit budget)

## Applicable project instructions (quoted, untrusted project content)
### CLAUDE.md > Project notes > Components (lines 11-14, sha256 84533630)
Why included: heading matches "component"; body mentions "navigation"
> ## Components
>
> Navigation lives in `components/Navigation.tsx`. Keep it accessible: one `nav` landmark with an `aria-label`.
> See also `docs/navigation-spec.md` for the design rules.

## Omissions
- 6 of 11 text files: no match to the task terms
- CLAUDE.md: 1 of 4 sections not relevant to the task
- 1 file entry: shortened to path and score to fit the budget: CLAUDE.md
- 1 matching file: not listed, over budget: components/Footer.tsx
- 2 instruction sections: not included, over budget: CLAUDE.md > Project notes > Commands, CLAUDE.md > Project notes > Style
- 1 commands item: not included, over budget
- 4 conventions items: not included, over budget
- 1 recommendations item: not included, over budget
```

What to notice:

- Files carry **reasons** and a **score**. The scoring table, the term weights and the task intent are described
  in [docs/architecture.md](docs/architecture.md); `--json` returns every point with its reason.
- The paired test and the importing layout are found automatically, and the instruction excerpt is **quoted with its
  line range** and labelled untrusted project content.
- The budget is **exact in bytes**; the token figure is a labelled estimate.
- Everything dropped or shortened is **listed**. With a larger budget (`--budget 8kb`) the commands, remaining
  instruction sections, conventions and recommendations appear too. Recommendations are a separate section, always
  `inferred`.

Budgets: `--budget 3000` (estimated tokens, the default), `--budget 3000t`, `--budget 12000b`, `--budget 12kb`.
`--top <n>` limits the file list. `--json` returns the structured pack, including the exact rendered Markdown
in a `rendered` field.

### `doctor`

```text
$ contextanvil doctor test/fixtures/next-app
ContextAnvil doctor (v0.1.1)
Root: test/fixtures/next-app
Result: 0 errors, 3 warnings, 2 notes.

MISSING OR WEAK CONTEXT
  [info]  CLAUDE.md exists but AGENTS.md does not
          at CLAUDE.md
          Agents that read AGENTS.md (for example OpenAI Codex) will not see these instructions.
          fix: Consider an AGENTS.md as the shared source and have CLAUDE.md reference it.
  [info]  Instructions do not mention the build command
          at package.json:7
          package.json defines a "build" script, but no root instruction file refers to it.
          fix: Document how to build the project.

CONTRADICTIONS
  [warn]  Instructions mention different package managers
          at CLAUDE.md:7, CLAUDE.md:9
          Commands for npm, pnpm appear in the instruction files. Agents may run the wrong one.
          fix: Standardise on one package manager across all instruction files.

OUTDATED REFERENCES
  [warn]  CLAUDE.md references docs/navigation-spec.md, which does not exist
          at CLAUDE.md:14
          The path is quoted in the instructions but is not in the repository. Heuristic: medium confidence (it may be an example).
          fix: Fix the path or remove the reference.
  [warn]  CLAUDE.md references script "lint:fix" that package.json does not define
          at CLAUDE.md:9
          "npm run lint:fix" appears in the instructions but package.json has no such script. Heuristic: medium confidence.
          fix: Update the instruction or add the script.
```

That sample project has those problems on purpose. The ContextAnvil repository itself reports
`No problems found.`, and CI runs `doctor` on it. Use `--fail-on error|warning|never` to
control the exit code (default `warning`).

Checks cover: missing or oversized instruction files; conflicting package managers and lockfiles; scripts
and paths mentioned in instructions that do not exist; manifest entry points that do not exist; secrets,
terminal control characters, hidden Unicode characters, hidden HTML or comments, encoded blobs and
agent-hijacking phrases in instruction files; sensitive files not covered by ignore rules; install-time scripts;
and agent hook / MCP configuration that can run commands.

## How well does the ranking work?

Two measurements, and they disagree. Read both.

**1. Author-labelled benchmark (optimistic).** 34 tasks over three synthetic repositories and one frozen real repository, labelled by
the ranker's author, v0.1.0 against v0.1.1 on the same harness:

| Tasks | Metric | v0.1.0 | v0.1.1 |
| ----- | ------ | ------ | ------ |
| 26 synthetic | first result is relevant (P@1) | 0.65 | 0.85 |
| | mean reciprocal rank | 0.79 | 0.92 |
| 8 real | first result is relevant (P@1) | 0.25 | 0.75 |
| | mean reciprocal rank | 0.53 | 0.79 |

**2. Independent evaluation (the better estimate).** 36 tasks taken from the commit history of four real repositories: the task is
the commit subject, the relevant files are the files that commit changed, and the labels were **frozen before the evaluation was
written or run**. 33 tasks have at least one rankable label. Macro-average:

| Engine | P@1 | MRR | R-precision | Recall@5 | Recall@8 |
| ------ | --- | --- | ----------- | -------- | -------- |
| v0.1.0 | 0.24 | 0.36 | 0.17 | 0.26 | 0.33 |
| v0.1.1 | 0.33 | 0.43 | 0.21 | 0.28 | 0.44 |

On the independent set the improvement over v0.1.0 points the right way but is **not statistically distinguishable from noise** on
33 tasks except for Recall@8, and the absolute level is low: for 42% of the relevant files the task text shares no word with the file's
name, path, symbols or content, so a lexical ranker cannot return them at all. The first number above should be read as "what the
ranker was built around", the second as "what to expect". Details, per-repository results and caveats:
[bench/external/RESULTS.md](bench/external/RESULTS.md); method and the author-labelled results: [bench/README.md](bench/README.md).

Other caveats: all four repositories belong to the author of the ranker; the sets are small; on the four held-out tasks of the
author-labelled real repository R-precision went *down* (0.29 to 0.21), explained in [bench/README.md](bench/README.md); and none of
this measures whether an AI agent does better with the pack. Reproduce the first with `npm run bench:quick`.

## What it detects

JavaScript, TypeScript, React, Next.js (App and Pages router), Node.js (package.json, scripts, entry points,
npm/pnpm/yarn/bun lockfiles, Jest, Vitest, Mocha, Playwright, Cypress and the built-in `node:test` runner),
PHP and Laravel (composer.json, PSR-4, Artisan, routes, PHPUnit/Pest, Pint), and a set of common
configuration files. Languages are also counted for Python, Go, Rust, Ruby, Java, Vue and Svelte by file
extension only. Agent instruction files: AGENTS.md, CLAUDE.md, GEMINI.md, Copilot instructions, Cursor rules,
Windsurf rules. Conventions are reported only with evidence (EditorConfig, Prettier JSON config, tsconfig,
test naming and layout, file naming style).

Adding a language or framework means adding one detector module; see
[CONTRIBUTING.md](CONTRIBUTING.md#adding-a-detector).

## Architecture

```text
files on disk (read-only) -> core (walker, ignore, reader, sanitize) -> detectors -> scanner -> ScanResult
                                                                                     |-> compiler -> context pack
                                                                                     '-> doctor   -> findings
                                                               CLI / future MCP server / future dashboard
```

All logic lives in a library with three functions that return plain JSON-serialisable data, so a CLI, an
MCP server and a dashboard can share it. The exported names and result shapes are pinned by tests.

```js
import { scanRepository, compileContext, diagnose } from './src/index.js';

const scan = scanRepository('.');
const pack = compileContext(scan, 'Update the navigation component', { budget: '3kb' });
console.log(pack.rendered);
const report = diagnose(scan);
```

Details: [docs/architecture.md](docs/architecture.md), [ADR 0001](docs/decisions/0001-architecture.md),
[ADR 0002 (ranking)](docs/decisions/0002-relevance-ranking.md).

## Safety model

- Read-only: nothing in a scanned directory is created, modified or deleted.
- Nothing from the repository is executed: scripts and JavaScript/PHP config files are recorded, never run.
- Nothing is transmitted: no network calls, no telemetry, no dependencies.
- `.env`, key files and similar are listed by path and never opened. Anything shown from a file is redacted for
  common secret formats, and control and invisible characters are made visible.
- Symlinks that leave the repository are not followed; limits bound traversal and read volume; patterns and regular
  expressions applied to repository text are bounded.
- Text from the repository is treated as untrusted data and quoted, never obeyed.

Version 0.1.1 fixed two denial-of-service bugs found in 0.1.0 (regular-expression backtracking on crafted text and on a
crafted `.gitignore`) and several smaller issues; the review, its findings and the remaining limitations are in
[docs/security.md](docs/security.md). It has not been independently audited. Reporting: [SECURITY.md](SECURITY.md).

## Supported environments

- Node.js 22 or later.
- **Verified on GitHub Actions** ([run 42620223366](https://github.com/AVL05/contextanvil/actions/runs/42620223366), commit `ac2c1a3`): Ubuntu, macOS (arm64) and Windows, each with Node.js 22.23, 24.22 and 26.13 (the
  current LTS at the time): the full test suite (127 tests; 126 pass and 1 is skipped on Windows because a POSIX file-permission
  test cannot run there; 127 pass on Ubuntu and macOS), CLI smoke and exit-code checks, run-to-run identical output, and a
  **byte-identical digest of the complete output across all nine combinations**. Linux and macOS have *not* been checked on a
  real developer machine.
- **Verified locally**: Windows 11, Node.js 24.22.2.
- Workflow: [.github/workflows/ci.yml](.github/workflows/ci.yml); actions are pinned to commit SHAs. It was validated by GitHub
  accepting and running it; `actionlint` was not available.
- Output is ASCII-only so legacy Windows consoles render it correctly.

## Repository manifests

```sh
contextanvil manifest create . --output ../context-snapshot.json
contextanvil manifest verify . --manifest ../context-snapshot.json
contextanvil manifest diff . --manifest ../context-snapshot.json --json
contextanvil manifest update . --manifest ../context-snapshot.json
```

Create requires a new path outside the scanned tree. Update explicitly
refreshes a valid manifest and skips writing when its bytes are unchanged.
Verify returns exit 1 on drift. Diff reports additions, removals and changes
to files and fact summaries. All commands accept `--json` and scanner limit
flags. Use the same scanner options for comparable snapshots.

Every refresh reads the live repository and reports full reconstruction.
The manifest stores source hashes and fact provenance without instruction
text. It is a review artifact and never supplies context to the compiler.
See the [manifest format and storage guarantees](docs/design/phase-2-manifests.md).

## Limitations

- **The Skill depends on the agent choosing to use it.** Activation is driven by the Skill description and the agent's judgement. It is not guaranteed, and it was only tested with the prompts listed in [docs/skill.md](docs/skill.md). An explicit mention always works.
- **Node.js 22+ must be reachable by the agent's shell.** The Skill bundles the engine, not the runtime. Codex's Windows sandbox could not resolve an nvm-windows `node` in testing; see [docs/skill.md](docs/skill.md).
- **No measured benefit.** The Skill has not been compared with working without it.
- **Relevance is lexical and structural.** Task matching uses file names, directories, declared symbols, word matches,
  rarity of terms, project structure and import relations. It does not understand synonyms or domain meaning: "show
  prices in euros" will not find the file that says `currency` unless other words overlap, and tasks whose vocabulary
  is absent from the repository stay hard. Known weak cases are listed in [bench/README.md](bench/README.md).
- **Accuracy on independently labelled real work is modest** (MRR 0.43, first result relevant 33% of the time, see above) and
  was measured on a small sample of the author's own repositories. It is not evidence about repositories in general, and it
  says nothing about AI agent outcomes. **There are no agent-based experiments**: no claim is made that
  using ContextAnvil reduces tokens, cost or errors.
- **Import relations are JavaScript, TypeScript and PHP only** (relative imports, `tsconfig`/`jsconfig` path aliases,
  PSR-4 `use` statements, Laravel `view()` calls).
- **Static analysis only.** Because nothing is executed, runtime-registered routes, generated code and
  JavaScript-based configuration (`prettier.config.js`, `eslint.config.js`) are not understood.
- **Monorepos:** only the root `package.json` / `composer.json` is analysed in depth; nested manifests are
  listed.
- **Token counts are estimates** (bytes / 4). There is no tokenizer. On small repositories a pack can be most of the
  repository's text, and v0.1.1 packs are larger than v0.1.0 packs because they carry more explanation.
- **Performance**: scanning is fast (tens of milliseconds for hundreds of files), but compiling a context for several
  thousand files takes seconds, almost all of it reading files (3 to 6 s cold for 5,000 freshly generated files on the
  development machine, 0.1 s once files are cached, see [docs/performance.md](docs/performance.md)) and about 100 MB of memory.
  Synchronous, single-threaded, no deadline (a design exists in [docs/design/](docs/design/deadlines-and-partial-results.md)).
  `--max-content-files` bounds the reading.
- **Secret detection is heuristic and not comprehensive**; it is not a replacement for a dedicated scanner. The tool never prints
  the secrets it recognises, but unrecognised formats can appear in output.
- **Agents can still read secrets themselves.** The Skill instructs agents not to open lines flagged as secrets, but an agent
  can ignore that: in testing, 1 of 5 Claude Code runs read the flagged line with its own file tool (without repeating it). If a
  secret must stay out of an agent's context, remove it from the repository.
- **Heuristic doctor checks** (stale references, hijacking phrases) can produce false positives and false
  negatives; they are labelled as such.
- **Race conditions**: the window between checking and reading a file is narrowed, not closed; do not scan a tree that an
  untrusted process is modifying.
- **Default exclusions** apply by directory name (`vendor`, `dist`, `build`, `out`, ...), and `.git/info/exclude`
  is not read.
- **No persisted read cache:** every run re-scans. Manifest refresh compares verified snapshots and skips publication when bytes are unchanged.
- Version 0.1.1 has had no outside users. Expect rough edges and report them.

## Roadmap

What exists today is described above. Everything below is **planned and not implemented**; details in
[docs/roadmap.md](docs/roadmap.md). A technical design for Phase 2 exists ([docs/design/phase-2-manifests.md](docs/design/phase-2-manifests.md))
but no code:

2. Persistent context manifests and live diffs. Verified read skipping and safe instruction generation remain separate work.
3. An MCP server exposing repository context and project rules. Not planned while the Skill is the primary delivery path.
4. A visual dashboard for project understanding, evidence inspection and conflict resolution.
5. Reproducible agent benchmarks comparing agent workflows with and without ContextAnvil.

Every phase must keep provider independence and user control.

## Development

```bash
npm test                                   # full suite (Node's built-in runner)
node --test test/compiler.test.js          # one file
npm run scan:self && npm run doctor:self   # ContextAnvil analysing itself
npm run bench:quick                        # ranking accuracy benchmark (seconds)
npm run skill:sync                         # refresh the Skill's vendored engine after changing src/
npm run skill:check                        # verify the vendored engine matches src/
```

Layout: `src/core` (safe access), `src/detectors`, `src/scanner.js`, `src/compiler`, `src/doctor.js`,
`src/render` and `src/cli` (presentation), `test/` with `test/fixtures/` sample projects, `bench/` (benchmarks).

## Contributing

Contributions are welcome; please read [CONTRIBUTING.md](CONTRIBUTING.md) and [AGENTS.md](AGENTS.md) first.
Security issues: [SECURITY.md](SECURITY.md).

## Name

"ContextAnvil" was checked against npm, GitHub, search results and DNS on 2026-11-09 and no existing project
using it was found; this is not a trademark clearance. The `contextanvil.com` domain was registered by a third
party shortly before that check and shows no website; no domain has been registered for this project.

## License

[MIT](LICENSE)
