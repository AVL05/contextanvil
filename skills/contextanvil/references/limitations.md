# Limitations

State these to the user when they affect the conclusion.

- **Heuristics.** Stale-reference checks are medium confidence. A quoted path or script name may be an
  illustrative example. Always verify against the cited line.
- **Prompt-injection detection is narrow.** It matches a fixed set of phrases. A clean report does not prove
  an instruction file is safe.
- **Ecosystem coverage.** Script and package-manager checks understand Node.js manifests best. Other
  ecosystems (for example PHP/Laravel) are recognised for facts but receive fewer checks.
- **Ranking accuracy is modest.** Context ranking is a deterministic heuristic, not a model. See the
  repository `bench/` results for measured accuracy.
- **No measured benefit.** There is no measurement that using this Skill reduces tokens or improves coding
  results in your session. Do not claim it.
- **Large repositories.** Defaults stop at 20,000 files, depth 25 and 512 KB per file. `scan`-category
  findings tell you when that limit was hit; the analysis is then partial.
- **Requires Node.js 22+.** The Skill bundles the analyser but not a Node.js runtime.

## Node.js not reachable from the agent's shell

If `node` is "not recognized" or the launcher fails with "Access denied", report it to the user and stop. Do
not install Node.js, copy executables or change PATH or sandbox settings yourself.

Known cause (Windows, Codex sandbox): commands run as a separate sandbox user that cannot read the current
user's profile folder. A per-user Node.js manager such as nvm-windows keeps `node.exe` there, so `node` is on PATH
but cannot be executed. Tell the user the minimum workaround: make a Node.js 22+ available from a location that
every local user can read, such as `C:\Program Files\nodejs` (the standard installer location), and start a new
agent session so the sandbox sees it. See `docs/skill.md` in the ContextAnvil repository for what was verified.
