import { VERSION } from '../version.js';

const LIMIT_OPTIONS = `  --max-files <n>        Stop indexing after n files (default 20000)
  --max-depth <n>        Maximum directory depth (default 25)
  --max-file-size <size> Skip reading files larger than this (default 512kb)
  --no-gitignore         Do not apply .gitignore / .contextanvilignore rules`;

export const HELP = {
  main: `ContextAnvil ${VERSION} - Forge better context.

Audit repository instructions, compile traceable context, and verify snapshots.
Offline analysis leaves the scanned repository unchanged.

Usage:
  contextanvil scan [path]                 Analyse a repository and report what was found
  contextanvil context "<task>" [path]     Compile focused context for a task
  contextanvil doctor [path]               Diagnose missing, conflicting, stale or unsafe context
  contextanvil manifest <action> <path>    Create, verify, diff or update a repository snapshot
  contextanvil --help | --version

Scan, context and doctor default to the current directory. Manifest actions
require an explicit path. Use "contextanvil <command> --help" for options.
All four command groups accept --json.

Exit codes: 0 success, 1 doctor findings or manifest verification mismatch, 2 usage error,
3 runtime error.
`,
  manifest: `Usage:
  contextanvil manifest create <path> --output <file> [--json]
  contextanvil manifest verify <path> --manifest <file> [--json]
  contextanvil manifest diff <path> --manifest <file> [--json]
  contextanvil manifest update <path> --manifest <file> [--json]

Create refuses existing destinations. Update explicitly replaces a valid manifest.
Choose a destination outside the scanned repository. All actions reconstruct
the live snapshot. Verify exits 1 on drift. Diff exits 0 on a complete comparison.
Invalid manifests, incomplete snapshots and storage failures exit 3.

${LIMIT_OPTIONS}
`,
  scan: `Usage: contextanvil scan [path] [options]

Analyse a repository: languages, frameworks, manifests, entry points, scripts,
test frameworks, source directories, conventions and agent instruction files.
Every item cites the file (and line) it came from. Nothing is executed or modified.

Options:
  --json                 Print the full result as JSON
  --files                With --json, include the indexed file list
${LIMIT_OPTIONS}
  -h, --help             Show this help
`,
  context: `Usage: contextanvil context "<task>" [path] [options]

Compile a source-grounded context pack for a task: the most relevant files (with
reasons), applicable instruction excerpts, commands and conventions, plus an
explicit list of what was omitted. Deterministic: no model calls.

Options:
  --budget <size>        Output budget: 3000 or 3000t (estimated tokens, default 3000),
                         12000b / 12kb (bytes). Token counts are estimated as bytes/4.
  --top <n>              Maximum number of relevant files to list (default 8)
  --max-content-files <n>  Read at most n files for symbol and content matching (default 5000).
                         0 matches by path only. Lower is faster on huge repositories; files not read are matched by path only
                         and the omission is reported. Deterministic, unlike a time limit.
  --json                 Print the structured pack (including the rendered Markdown)
${LIMIT_OPTIONS}
  -h, --help             Show this help
`,
  doctor: `Usage: contextanvil doctor [path] [options]

Check the repository's agent-facing context for missing instructions,
contradictions (for example two package managers), outdated references (scripts
or paths that no longer exist) and potentially unsafe content (secrets, hidden
characters, instruction-hijacking phrases, sensitive files).

Options:
  --fail-on <level>      Exit 1 when findings reach this level: error, warning
                         (default) or never
  --json                 Print the report as JSON
${LIMIT_OPTIONS}
  -h, --help             Show this help
`,
};
