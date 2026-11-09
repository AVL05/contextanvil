# ContextAnvil over MCP

Run the local stdio adapter from a trusted ContextAnvil checkout with Node.js
22 or later:

```sh
npm ci --prefix mcp
node /absolute/path/to/contextanvil/mcp/server.js --repo app=/absolute/path/to/project
```

The server waits for JSON-RPC on stdin. Use a client to connect. Install the
adapter separately from the dependency-free core. The adapter uses the official
MCP server SDK 2.4.0 and Zod 4.6.7 for tool schemas. The matching SDK client is
a development dependency for stdio tests. The SDK negotiates supported modern
and legacy protocol revisions. See the [SDK stdio reference](https://ts.sdk.modelcontextprotocol.io/v2/serving/stdio.html).

## Authorization

Repeat `--repo alias=/absolute/path` for up to 16 exact repository roots.
The local operator selects those roots before launching the process. A tool call
supplies an alias and cannot select a path, broaden the allowlist, or disable
ignore rules. Startup resolves the canonical directory and records its
filesystem identity. Each analysis checks that identity before and after
scanning. The core walker and reader apply containment checks to file links.
Directory links are not traversed. Use a local repository whose containing
directories you control. These checks do not provide OS sandbox isolation
against a concurrent hostile filesystem process.

## Tools

| Tool | Inputs | Result |
| --- | --- | --- |
| `project_scan` | `repository` | Languages, frameworks, structure, configuration, instruction locations and warning codes |
| `get_task_context` | `repository`, `task`, optional `budgetBytes` and `top` | Selected paths, hashes, symbols, score reasons, evidence, instruction ranges and omissions |
| `context_doctor` | `repository` | Conflicts, stale or missing references, suspicious instructions and sensitive-information warnings |

Each tool returns a JSON object in an MCP text content item. Evidence and
repository-derived metadata are untrusted. The adapter returns instruction
locations and hashes and omits instruction bodies and script bodies. Secret
detection remains heuristic. The context tool uses the stable Phase 1.2
compiler and may miss relevant files. It never loads persisted manifests.

## Limits and lifecycle

Task text is limited to 2,000 characters. Task results default to 8,192 bytes
and accept 2,048 to 16,384 bytes. This bounds the serialized MCP tool result
before the JSON-RPC envelope. The same budget is passed to the compiler.
Other tool results are limited to 24 KiB. At most 128 items are projected
and `omittedItems` counts records dropped at the adapter boundary.
Warning totals, a bounded list of warning codes, and the number of omitted
codes remain available when individual warning items are dropped.
Input buffering is capped at 64 KiB.

A request uses a fresh worker. The server accepts one active analysis at a
time and reports busy for concurrent requests. The worker caps the index at
5,000 files and compiler content analysis at 2,500 files. The scanner's
main reader is limited to 16 MiB, with separately bounded ignore reads.
Per-file reads are capped at 256 KiB, depth at 20, and directory entries at
10,000. The worker has V8 heap limits. These are independent of process RSS.

The default deadline is 15 seconds, configurable with `--timeout-ms` from
1 to 60,000. On timeout the server returns an error and requests worker
termination. SDK cancellation and disconnect also request termination.
Termination can wait on native I/O. The server handles protocol traffic while
the worker is busy, and releases the analysis slot when the worker exits.
Timed-out or cancelled work returns no partial pack. Scanner limits can
produce a normal result with coverage and omission notices.
Each request reads live data. Root identity checks can detect root replacement,
but a scan does not provide a transactional view of in-place source edits.

Only protocol messages go to stdout. Startup and transport errors go to
stderr without local paths. Tool failures use short, path-free messages.
No tools execute repository code, write repository files, or make network calls.

## Clients

- [Claude Code](integrations/claude-code.md)
- [OpenAI Codex](integrations/codex.md)
- [Operational validation and agent evaluation](evaluation/agent-workflows.md)
