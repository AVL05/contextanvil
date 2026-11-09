# Operational validation and agent workflows

## Manifest operations on real repositories

Windows, Node 24.22.2, one observation per operation. Each original and edited
tree came from an immutable Git archive. A newline was added to the edited
copy's README before scanning. Manifests, locks and temporary files were
outside the scanned trees. The first observation was on a newly extracted
tree. Later observations used fresh Node processes with a warmer OS cache.
Cache state and antivirus cost were uncontrolled, so first-run and subsequent
times are not a measure of algorithmic speedup.

| Snapshot | Reads | Source bytes | Manifest bytes | First create | Unchanged update | Edited update | Peak RSS range |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| Express `43fca52d28a422c8be48fd489cbd4f2d6152bab6` | 216 | 754,315 | 45,683 | 11.61 s | 100 ms | 103 ms | 55.7–56.5 MiB |
| Preact `cf50052eee0718a4e02614d3c2383e690462242e` | 310 | 1,827,726 | 77,001 | 10.83 s | 121 ms | 125 ms | 57.0–57.9 MiB |
| Laravel framework `4997a3c1607f0fa28b15292b4c4d0c357fbc1a76` | 1,942 | 8,217,491 | 376,046 | 100.98 s | 600 ms | 645 ms | 63.0–64.5 MiB |

Verify matched all three original snapshots. Unchanged updates skipped
publication. Edited updates read one extra byte, kept the same read count
and matched fresh reconstruction. In each tree, a process exit injected
before rename left the old manifest readable and the stale lock blocked an
update. Removing that lock after the worker exited allowed recovery. The
benchmark removed only its own temporary workspace. Existing temporary
files were not used as inputs or recovered as manifests.

To repeat, extract each pinned archive into two isolated directories and
prepare the edited copy before scanning. Use the same external manifest
path for `node bench/manifest.js create <original> <manifest>`,
`node bin/contextanvil.js manifest verify <original> --manifest <manifest> --json`,
and `node bench/manifest.js update <tree> <manifest>` against each tree.
The interruption injection is covered by the manifest tests.

## MCP overhead smoke measurement

On the ContextAnvil checkout, the SDK client measured 80 ms for project scan,
372 ms for the first task context and 113 ms for a repeated task, and 76 ms for
doctor. The task result was 5,405 serialized bytes. The server process peaked
at about 97 MiB working set across the sequence, including its worker.
These single-host samples include worker startup and protocol handling.
The repeated request starts a new worker and rereads the repository.

## A/B harness

Model-driven A/B execution remains pending. Native host connection and tool
calls are tracked separately from whether an agent chooses to call the tool.

1. Pin the ContextAnvil commit, the client and model versions, and the
   client permissions. Run `node bench/agent-eval.js prepare <new-directory>`
   to create identical fixture copies and write the prompts and relevance rubric.
2. Open one fresh session per copy. Arm A has ContextAnvil disabled. Arm B
   authorizes only that copy through the host's MCP settings. Keep other tools
   and prompts identical. Alternate order and use multiple fresh pairs before
   generalizing. Avoid carrying transcripts or cached results across arms.
3. Review each resulting diff. After review, run
   `node bench/agent-eval.js grade <directory> <case> <A|B>`.
   This explicit grader executes edited fixture code. Run it in an isolated
   evaluation environment. A grader failure records `correct: false`.
4. Record each observation in a JSON array. Include `caseId`, `arm`,
   `correct`, `discovered` (paths found in agent tool traces),
   `toolCalls`, `contextAnvilCalls`, `contextBytes` (UTF-8 bytes of
   ContextAnvil responses, zero without calls), and `elapsedMs`.
   Include `apiTokens` only if the host reports comparable token usage.
5. Run `node bench/agent-eval.js summarize <observations.json>` to calculate
   relevant-file discovery and report outcomes per arm. Keep individual
   observations, failed tasks and unused integrations in the results.

Context bytes are not billed tokens. Additional tool calls can increase
total work. The fixture rubric is small and intended for an initial
paired experiment, not a general estimate of agent quality.
