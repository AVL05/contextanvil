# Phase 3.1 MCP pilot

## Decision

**NO-GO for merge.** Keep the adapter experimental. Claude Code used
ContextAnvil successfully when explicitly asked, but never selected it
unprompted on these three small tasks. The paired runs cannot establish an
improvement in agent outcomes.

## Environment and protocol

Windows, Node 24.22.2, Claude Code 2.1.318. All seven model sessions resolved
the same `claude-sonnet-5-5` model and used low effort. Codex CLI 0.166.0
discovered the three tools and returned navigation evidence through a native
task-context call after the warning-summary fix. Codex did not participate in
the model-driven comparison.

The paired pilot used the three repository fixtures from the PR's initial
review head `973be3f4e993d65072c4ce1e8d188c21a104e03d`. Each arm used a fresh
copy and a fresh session with no saved conversation. Arm A had an empty MCP
configuration. Arm B authorized only its copy. Both arms used the same
prompt, accept-edits permissions, and Read, Edit, Glob and Grep tools. Strict
MCP configuration prevented inherited servers. Ordering within the pairs was
A/B, B/A and A/B respectively. Pairs ran concurrently. Session timing
includes CLI startup and may reflect service load and cache differences.

The [harness](../../bench/agent-eval.js) defines the prompts and the relevance
rubric. Run `node bench/agent-eval.js prepare <new-directory>`, then run Claude
from each prepared copy with the prompt in `cases.json`. For this pilot the
host flags were:

```sh
claude -p --verbose --output-format stream-json --model sonnet --effort low \
  --no-session-persistence --strict-mcp-config --setting-sources "" \
  --permission-mode acceptEdits --tools Read,Edit,Glob,Grep \
  --allowedTools 'mcp__contextanvil__*' --mcp-config /absolute/path/to/arm.json \
  -- "<case prompt>"
```

Check the resolved model in the init event. Use an empty `mcpServers` object
for A and the documented stdio configuration with alias `app` for B.
Keep the configuration and transcript outside the scanned copies.

## Paired results

| Scenario and criterion | Arm | Correct | Discovered (relevant / all) | Calls (MCP) | MCP text bytes | Wall time |
| --- | --- | --- | --- | --- | --- | --- |
| Node: trim slug input and preserve normalization | A | Yes | 1/1 | 3 (0) | 0 | 18.13 s |
| Node: trim slug input and preserve normalization | B | Yes | 1/1 | 3 (0) | 0 | 13.17 s |
| Next.js: add Contact without removing links or changing the nav label | A | Yes | 1/3 | 3 (0) | 0 | 29.19 s |
| Next.js: add Contact without removing links or changing the nav label | B | Yes | 1/3 | 2 (0) | 0 | 14.19 s |
| Laravel: add a GET alias and preserve route and controller behavior | A | Yes | 2/5 | 3 (0) | 0 | 15.32 s |
| Laravel: add a GET alias and preserve route and controller behavior | B | Yes | 2/5 | 3 (0) | 0 | 9.51 s |

The Node grader executed slugify assertions. The React and Laravel graders
checked the fixture source and were supplemented by diff review. No full
Next.js build or PHP runtime test ran. Each session changed only the expected
file and reported zero tool errors. Grep surfaced some additional files in
Next.js and Laravel, but none of those results caused unrelated edits.

Claude connected in all three enabled sessions and invoked ContextAnvil in
**0/3**. All six tasks passed. Discovery was derived from filenames in tool
results and files read or edited. The timings and one fewer call in Next.js
cannot be attributed to MCP. The [normalized observations](../../bench/mcp-pilot/observations.json)
retain the individual tool sequences, files, error counts and raw host token
counters, including cached input. Those counters are not billed tokens.
Original stream logs were kept in the isolated pilot workspace and excluded
from Git because they contain host paths and session metadata.

### Guided follow-up

A fresh Next.js session with the same model and settings was explicitly
asked to call `get_task_context` first. It called once and received
**3,073 UTF-8 bytes of text**. It subsequently made two Reads, one Edit and
one Glob. The change passed diff review and took **21.55 s**. This
[unpaired observation](../../bench/mcp-pilot/guided.json) establishes that
the agent can use metadata to discover files when prompted. It also shows
that the agent still read source before editing.

## Metadata versus experimental excerpts

A separate development probe requested the three tasks through the SDK over
stdio. The expected primary file appeared in all three metadata results.
For each result, a local probe appended one hand-selected, three- or four-line
excerpt from that fixture file, with path, line range, matching digest and
an untrusted-data marker. This augmentation stayed outside the adapter and
used only the known fixture lines. It was not served to model sessions.

| Task | Metadata-only serialized result | With one excerpt | Cue added by excerpt |
| --- | ---: | ---: | --- |
| Slugify | 1,536 B | 1,823 B | The normalization chain and where to trim |
| Navigation | 3,896 B | 4,231 B | Existing links and nav label |
| Members | 4,453 B | 4,802 B | Route binding and controller import |

Excerpts supplied edit cues but added 287–349 bytes without changing
file discovery. Hand selection does not establish that a general selector
would choose useful or safe lines. Metadata remains the default and no
excerpt feature was added. Any further comparison needs model sessions
that actually consume each form and a policy for safe excerpt selection.

## Reliability and security review

- The alias map admits only configured roots. The worker rechecks canonical
  path and filesystem identity around analysis. The reader rejects escapes.
  Identity checks catch root replacement but do not give a transactional
  view of in-place edits. The tests verify new hashes after an edit between
  calls. The adapter continues to omit raw source and instruction bodies.
- Found and fixed warning starvation. Detailed warnings could all disappear
  behind facts or instructions at either projection cap. The response now
  carries a warning total, bounded code list, and omitted code count in
  its envelope. A large malformed fixture exercises the truncation path.
- Protocol tests cover one-active-request backpressure, cancellation followed
  by another successful analysis, two timed-out analyses with slot recovery,
  malformed input, and shutdown with active work. A one-millisecond deadline
  exercised timeout cleanup. No stalled native filesystem was induced.
  Termination can still wait on native I/O, and while it does, analysis
  requests can receive busy responses.
- The development probe measured **179 ms** to connect and **65–81 ms** for
  six sequential fixture calls, with about **91.4 MiB** peak working set for
  the server process including its worker. Each call started a new worker.
  These single-host observations do not establish a latency percentile or
  whether the single-worker slot bottlenecks larger, concurrent workflows.

The next decision needs a larger, pinned task set where file discovery is
hard enough that MCP could plausibly change the workflow. Keep prompted
usage separate from spontaneous usage, and collect a paired Codex arm if
drawing conclusions about Codex agents.
