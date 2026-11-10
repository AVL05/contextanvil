# The ContextAnvil Agent Skill

Design, installation tests and known limitations of the Skill in `skills/contextanvil/`.

## Structure

```text
skills/contextanvil/
  SKILL.md                      name, description, concise instructions (under 120 lines)
  references/
    audit-workflow.md           steps and report format for an instruction audit
    findings.md                 catalogue of `doctor` finding IDs and usual remedies
    context-preparation.md      using the `context` command and its output
    safety.md                   engine guarantees and the agent's responsibilities
    limitations.md              what to tell the user when it matters
  scripts/contextanvil.mjs      launcher
  src/, package.json            generated copy of the engine (scripts/sync-skill.js)
```

Progressive disclosure: the agent always sees the `name` and `description`; it reads `SKILL.md` when the Skill
is relevant, and opens a reference only when the task needs it.

### Why the engine is copied into the Skill

`npx skills add` copies the Skill directory and nothing else. It does not run `npm install` and it does not
create a `contextanvil` executable on `PATH`. A `SKILL.md` that said "run `contextanvil doctor`" would fail on a
clean machine. So the Skill carries its own copy of `src/` (about 190 KB across 35 files) and a launcher that runs it
with the Node.js already on the machine. `npm run skill:sync` regenerates the copy; `npm run skill:check`, CI and
`test/skill.test.js` fail when it differs from `src/`. A bundler was not used because it would add a build
dependency to a dependency-free project.

The copy has its own `package.json` with `"type": "module"`. Without it, Node.js resolves `.js` files against
the *host project's* `package.json`, which breaks when the Skill is installed inside a CommonJS project. The test
suite installs the Skill into such a project to guard against this.

### Launcher

`scripts/contextanvil.mjs` checks for Node.js 22+, allows only `scan`, `doctor` and `context` (plus `--help` and
`--version`), and calls the engine's CLI entry point. `manifest`, the one command that writes files, is refused
with exit code 2. The launcher takes the repository path as an argument and can run from any working directory.

## Activation design

The `description` states positive triggers (auditing or improving instruction files, stale or conflicting
instructions, checking an unfamiliar repository, complex exploration) and a negative one (simple, well-scoped
edits). `SKILL.md` repeats the negative case, asks for one analysis per question, and defaults to terse output. In
both agents, a plain-language audit request loaded the Skill without it being named.
Nothing runs a scan unless the Skill is activated, and activation is the agent's decision.

Not measured: how often agents activate it falsely on unrelated tasks, and whether it changes cost or quality.

## Installation tests

Environment: Windows 11, Node.js 24.22.2, Claude Code 2.1.318, Codex CLI 0.166.0, the `skills` installer fetched
by `npx`. The Skill was installed from a local checkout into throw-away projects (project scope), because the Skill
was not yet on `main`. Test repository: a generated project with intentional defects (conflicting `pnpm`/`npm`/`yarn`
commands, a missing script, three missing paths, a prompt-injection phrase, a hidden-character line, a hide-from-user
phrase, and a fake AWS-format key assembled at run time).

| Check | Claude Code | Codex |
| ----- | ----------- | ----- |
| Installer places Skill | `.claude/skills/contextanvil` (symlink to `.agents/skills/contextanvil`; also verified with `--copy`) | `.agents/skills/contextanvil` |
| Skill discovered | Listed in the session's skill list; loaded by a plain-language audit request and by `/contextanvil` | Loaded by a plain-language audit request (it read `SKILL.md` first) |
| Bundled analyser runs from installed path | Yes, from another working directory | Yes, once `node` was reachable (see limitation 1) |
| Findings correct | Yes: 10 findings in the final report, each with `path:line`; two items beyond the tool's output were labelled as the agent's own judgement | Yes: every finding in the final report had the right `path:line` |
| Secret value leaked into transcript | No (0 occurrences) | No (0 occurrences) |
| Defect repository modified | No (SHA-256 of every file identical before and after) | No (same check) |

Independently of the agents, `test/skill.test.js` installs a copy into a CommonJS host project, runs the launcher
from an unrelated working directory against a defect repository, checks the line number of each expected finding,
checks that the secret is not printed, and compares a digest of the repository before and after.

## Platform-specific limitations

1. **Codex on Windows, `node` not reachable (nvm-windows).** Codex runs commands as a separate sandbox user
   (`CodexSandboxOffline`). On the test machine `node` came from nvm-windows: `C:\nvm4w\nodejs` is a symbolic link to
   `C:\Users\<user>\AppData\Local\nvm\<version>`, and the permissions on that folder list only SYSTEM, Administrators and
   the user. Inside the `workspace-write` sandbox, listing that folder and running `node.exe` (through the link and
   directly) both returned "Access denied", while `C:\Program Files\Git\cmd\git.exe` ran. The Skill therefore reported that
   Node.js was unavailable and stopped, as designed.

   **Minimum workaround:** use a Node.js 22+ that lives in a location every local user can read, such as
   `C:\Program Files\nodejs`, and start a new Codex session. Nothing in the Skill, PATH or sandbox settings has to change,
   and no executable has to be copied.

   **Verified:** a Node.js 22.22.0 binary already present under `C:\Program Files` (shipped with another application)
   ran the installed launcher inside the `workspace-write` sandbox, and the analysed repository was unchanged.
   **Not verified:** the official Node.js installer, other Windows setups (other version managers, corporate policies,
   other Windows versions), and a Codex run with its sandbox disabled. An earlier test that copied `node.exe` next to the
   project also worked, but it is not a recommended workaround.
2. **Codex on Windows, protected directories.** A first attempt put the test projects under a protected temp directory;
   the sandbox denied reads there. Use ordinary project directories.
3. **Symlinks.** The installer links `.claude/skills/contextanvil` to the `.agents` copy. This worked for Claude Code on
   Windows 11 in the test. Where creating symlinks is not permitted, use `--copy`.
4. **Linux and macOS** were not tested with the real agents. The engine's own test suite runs on all three platforms in CI.
5. **Install from GitHub.** `npx skills add AVL05/contextanvil` resolves against the default branch, so it works only after this work is merged. Installing from the pushed branch with `npx skills add AVL05/contextanvil#feat/agent-skill` was verified: the same files were installed and the launcher ran. The bare command was not run against `main`, because `main` has no Skill yet.
6. **Language.** Codex answered in Spanish in testing (the machine's Codex configuration, not the Skill); the Skill content is English.

## What was not tested

- Other agents the installer supports.
- Activation precision on unrelated tasks.
- Large repositories through the agents (the engine's own performance numbers are in `docs/performance.md`).
- Whether the Skill saves tokens or improves outcomes. No claim is made.

## Known issue found during final review

In one Claude Code run against the default-branch install, the agent's own `Grep` call returned the flagged secret line into its
context while it was verifying findings. The value was not repeated in its answer, but it had been read. The Skill's instructions had
told the agent both to open every cited line and never to read flagged secrets. They now say explicitly not to open, search or print
secret-flagged lines and to read other lines by range.

**This reduces the risk but does not prevent it.** After the change, 4 of 5 Claude Code runs kept the fake key out of the transcript; in
the fifth the agent read the whole `AGENTS.md` with its `Read` tool, putting the line into its context, again without repeating it in
its answer. A Codex run skipped the flagged line explicitly. The engine's own output never contains the value (covered by
`test/skill.test.js`). A structural fix, such as a launcher command that prints redacted excerpts for verification, was not built.
