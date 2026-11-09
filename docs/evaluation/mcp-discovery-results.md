# Phase 3.2 discovery value evaluation

## Decision

**NO-GO for merge.** Keep PR #8 in draft and postpone integration. Guided
ContextAnvil surfaced both Express targets earlier in one session, but the
patch missed the frozen normalization criterion. In Laravel, the guided
request timed out and the agent did not fix reconnect behavior. Availability
alone produced no invocations. These two development tasks cannot establish
general productivity or token savings.

## Frozen tasks and environment

[Task definitions and grading criteria](../../bench/mcp-discovery/cases.json)
were committed before any agent session in `c70b2a4`. These are independent
upstream regressions, run on the parent of each upstream fix. The prompt
describes symptoms and does not identify implementation or test files.

| Task | Source and snapshot | Essential evidence |
| --- | --- | --- |
| Express chunked response loses automatic ETag | expressjs/express at `3ce6d0eb86e9d93529ff3191c6bb5db8ce6e72c8`, upstream fix `9a34acf03cb818ff3f8bc40e44176e277a25cbb9` | `lib/response.js`, `test/res.send.js` |
| Laravel connection loss during commit prevents recovery | laravel/framework at `0406274cae8fc36f01d76d9e3d9f4c0395b99824`, upstream fix `703ffc3617cdea72e626f45e008b3ef1ecf82262` | `src/Illuminate/Database/Concerns/ManagesTransactions.php`, `tests/Database/DatabaseConnectionTest.php` |

Both labels in each task are essential to the requested implementation and
regression test. No incidental edit labels were assigned. Both repositories
use MIT licenses at the pinned snapshots. These tasks are development cases,
not a sealed holdout.

Windows, Node 24.22.2, Claude Code 2.1.318, resolved model
`claude-sonnet-5-5`, low effort, no session persistence. Each arm received a
fresh isolated tree, the same base prompt, and the same Read, Edit, Glob and
Grep permissions. B and C configured the same local alias and default
15-second MCP deadline. C added one instruction to consult
`get_task_context` before exploration. Express ran A/B/C and Laravel C/B/A.
The two first groups ran concurrently. Service load and OS file caching were
uncontrolled. A and B occasionally attempted disabled commands, which were
recorded as tool errors rather than successful exploration.

The initial Laravel archive omitted `tests/` and other tracked paths via
upstream `export-ignore`. Those sessions are **invalid for comparison** and
are retained in [archive-invalid.json](../../bench/mcp-discovery/archive-invalid.json).
Laravel was rerun in all three arms with a temporary Git index and all tracked
files. Express has no export-ignore attribute and its original three sessions
remain in the comparison. The corrected runner verifies essential files exist
before starting any session.

## Correctness

- **Express A and B passed the frozen rubric.** Both restored body
  normalization for automatic tags while suppressing Content-Length on
  chunked responses. Both added coverage for automatic and explicit tags.
- **Express C passed the HTTP behavior checks and failed the frozen
  normalization criterion.** It changed the ETag guard from defined length
  to defined body, leaving the chunked string unnormalized. A separate
  diagnostic custom ETag callback received a Buffer in A and B and a
  string in C. All three arms passed the nine focused transfer-encoding
  tests. The full `res.send.js` suite had the same two Content-Type
  expectation failures in the original and all three variants. The
  targeted HTTP grader failed on the original and passed on every variant.
- **Laravel A, B and C failed the frozen rubric.** All three modified the
  manual commit path and reset the transaction counter but left the dead
  PDO attached. None demonstrated a successful next transaction in its
  regression test. This judgment comes from source and diff review. PHP
  and Composer were unavailable, so the PHP tests were not executed.

## Adoption and utility

[Normalized observations](../../bench/mcp-discovery/observations.json) retain
the exact paths, tool sequences, errors and host-reported token counters.
Both labels are essential, so relevant and essential counts coincide.
Discovery includes file paths returned by search, reads and MCP.
Time to first essential file is measured at the tool result, not at the
start of its call. Express start time is approximated from the timing file
write and process duration. Laravel has explicit process start timestamps.

| Task | Arm | Rubric | Essential / all discovered | First essential | Searches / reads / total calls | MCP calls / text bytes | Elapsed | Output tokens |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| Express | A | Pass | 2 / 2 | 17.59 s | 3 / 1 / 8 | 0 / 0 | 43.03 s | 2,661 |
| Express | B | Pass | 2 / 13 | 21.49 s | 3 / 1 / 7 | 0 / 0 | 51.55 s | 2,694 |
| Express | C | Fail | 2 / 8 | 7.81 s | 2 / 2 / 7 | 1 / 4,094 | 34.94 s | 2,008 |
| Laravel | A | Fail | 2 / 2 | 25.63 s | 4 / 2 / 8 | 0 / 0 | 49.53 s | 2,673 |
| Laravel | B | Fail | 2 / 4 | 24.43 s | 2 / 2 / 7 | 0 / 0 | 68.98 s | 3,156 |
| Laravel | C | Fail | 2 / 3 | 43.30 s | 3 / 1 / 7 | 1 / 30 | 64.25 s | 2,409 |

Laravel C's 30 bytes were the timeout error. Express C had fewer output
tokens but more cache creation and cache reads than Express A or B.
Raw host counters are not billed tokens. No cost or token savings are
established by these single runs.

Claude advertised all three ContextAnvil tools and connected in all B and C
sessions. B invoked the adapter **0/2** times. C attempted one call in each
session. Express returned context, and Laravel returned a timeout error.
Visible tools and a successful guided call show that the integration was
reachable. They do not reveal the model's reason for choosing native tools.

The current name `get_task_context` describes the intent, and the schema
marks the tool read-only. It requires a repository alias, describes the
alias syntactically, and does not enumerate the configured values.
This may add friction on first use. The traces instead show a concrete
alternative: Grep and Read independently located both essential files
on both tasks. No alternative descriptions were tested and no production
descriptions, alias policy, or prompts in B were changed.

- **Express guided:** the first MCP result surfaced both essential files
  before native exploration. It returned eight file suggestions, of which
  six were outside the frozen labels. None establishes a false positive
  by itself. No unrelated file was edited. Native arms also found both
  essentials, so MCP accelerated discovery in this observation without
  increasing its final coverage. The agent still read source before editing.
- **Laravel guided:** MCP produced no file suggestions before the deadline.
  The agent fell back to native search, found both essential files and still
  chose the wrong commit path. In two separate SDK probes on the complete
  unedited tree with a 60-second deadline, the tool returned in 2.52 and
  2.50 seconds, with identical 6,821-byte outputs. Both suggested the
  essential database test and missed `ManagesTransactions.php`. Queue worker,
  cloud queue and database lock results consumed space without pointing to
  the exact edit. These probes were outside the model sessions. They do not
  isolate whether the cold timeouts came from OS caching, filesystem
  contention, or some other startup condition.

The Express trace supports a narrow metadata-only discovery use case.
It does not show that excerpts would repair the incorrect fix. No excerpts
were added or tested in this phase.

## Reproduction and safety

Use local clones with the pinned objects and an unused external directory:

```sh
node bench/mcp-discovery/run.js <clone-parent> <new-output-directory> <claude-executable>
node bench/mcp-discovery/collect.js <output-directory>
```

An optional task ID runs or collects a single case. The runner saves raw
stream JSON, timings and isolated work copies outside the repository. The
tracked observations contain only normalized paths, measurements and tool
names. The `--trace-changes` collector option byte-compares recorded edit
targets and files with changed size or a session-time modification, and
checks additions and removals separately. Without the option it compares
all bytes. Express grading uses `grade-express.cjs` with dependencies installed
in a separate directory and supplied via `NODE_PATH`. Run that grader only
after reviewing the agent's changes because it executes the edited Express
copy. The tested dependency setup used Express 5.2.1, Mocha 11.7.5 and
Supertest 6.3.4 outside the work copies.

No MCP, ranking, CLI or manifest code changed. Focused protocol tests passed
for authorization, symlink containment, result budgets, cancellation,
repeated timeout, root replacement and shutdown. Timeout behavior in the
agent traces is an operational limitation despite protocol recovery. The
one-request worker design and external-configuration requirements remain.
