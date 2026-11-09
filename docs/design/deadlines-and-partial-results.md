# Design: cooperative deadlines and partial results

Status: **design only**. The only code added in Phase 1.2 is the deterministic `--max-content-files` limit. No time-based
deadline is implemented, deliberately (see "What is justified now").

## Evidence of the risk

- Scanning and compiling are synchronous. A call cannot be interrupted from inside the process.
- On the generated 5,002-file repository a cold compile takes 3 to 6 s (`docs/performance.md`), almost all of it file reads.
  The default limits allow 20,000 files and 64 MiB of reads, so a worst case at the limits is plausibly tens of seconds. That
  figure is an extrapolation, not a measurement.
- Nothing in the default limits is unbounded, and no run hung within them (the two real hangs found in Phase 1.1 were
  regular-expression bugs, now fixed and covered by tests).

A command-line user can press Ctrl+C. An MCP server (Phase 3) cannot do that on a single-threaded event loop, so the risk is
real for the server and mild for the CLI.

## Principles

1. **Deterministic work limits come first.** `maxFiles`, `maxDepth`, `maxDirEntries`, `maxFileBytes`, `maxTotalReadBytes` and
   `maxContentFiles` stop work at a point that depends only on the input, so results stay reproducible, cacheable and
   comparable.
2. **A time deadline is a safety net, and its results are explicitly non-reproducible.** The same input can stop at a
   different place on a faster machine. Such a result must say so, and must never be cached, written to a manifest, or
   compared in a determinism check.
3. **A partial result must not look complete.** Every consumer has to be able to tell, and `doctor` must not draw
   conclusions from missing data.
4. **Failing safe beats failing fast.** No writes, no leaked file descriptors, no half-built state.

## API

```js
scanRepository(root, { deadline })        // deadline: { timeoutMs } or { at } (absolute performance.now() value)
compileContext(scan, task, { deadline })
diagnose(scan)                             // cheap, no deadline needed
// both also accept { signal: AbortSignal } for caller cancellation
```

One `Deadline` object (`{ expired(): boolean, check(): void }`) is created at the entry point and passed down; nothing reads the
clock except it. Time is `performance.now()` (monotonic), never wall-clock time.

### Where it is checked

| Place | Granularity | Reason |
| ----- | ----------- | ------ |
| Walker, before listing each directory | per directory | bounds traversal |
| Reader, before opening each file | per file (check the clock every 32 reads) | reads dominate cost |
| Analysis loop in the compiler | per file | same |
| Between compiler phases (terms, scoring, relations, packing) | per phase | CPU phases are about 100 ms at 5,000 files; finishing a phase is cheaper than half-finishing it |
| Doctor | none | linear in the scan, milliseconds |

The check is a comparison of two numbers; the cost is negligible next to a file read.

## Cancellation versus deadline

- **Deadline expiry returns a partial result** (below). The caller asked for "as much as fits in the time".
- **`AbortSignal` cancellation throws** `ContextAnvilError('CANCELLED')`. The caller no longer wants any result, so no partial data is
  returned. A signal can only be observed between synchronous steps, which is why a server must not rely on it alone (see
  "MCP").

## Partial-result semantics

A result produced under an expired deadline carries:

```json
{ "complete": false,
  "incomplete": [ { "phase": "walk" | "read" | "analyze", "reason": "deadline", "processed": 3120, "limit": null } ] }
```

and a diagnostic `{ level: "warn", code: "deadline-exceeded", message: "...", phase }`. Complete results carry `"complete": true`.

- **Walk.** Traversal is breadth-first over code-unit-sorted names, so a partial index is a *prefix of the full index in traversal
  order*, never an arbitrary sample. Facts derived from it are correct about the files seen and silent about the rest.
- **Read / analyze.** Files already analysed keep their symbols, imports and counts; the rest are matched by path only, exactly
  like the existing `content-limit` omission, and the pack lists the omission.
- **Detectors** run on whatever index exists. A fact that depends on something not yet seen is simply absent.
- **Doctor** refuses to report absence-based findings on an incomplete scan (`no-agent-instructions`, `agents-without-claude`,
  missing-command findings) and emits one `partial-scan` finding explaining why. Presence-based findings (a secret in a file
  that was read) remain valid.
- **Replayability.** A partial result records `processed` counts. Re-running with the corresponding deterministic limit
  (`maxFiles: processed`) reproduces the same index, which is how a bug report about a partial result can be reproduced.

### Warning and error codes

| Code | Meaning | Existing? |
| ---- | ------- | --------- |
| `file-limit`, `depth-limit`, `dir-entry-limit`, `read-budget-exhausted`, `file-too-large` | deterministic limits | yes |
| `content-limit` (omission) | `maxContentFiles` reached | yes |
| `deadline-exceeded` | time deadline expired; result is partial and not reproducible | proposed |
| `partial-scan` | a doctor/pack caveat derived from `complete: false` | proposed |
| `CANCELLED` (error) | aborted by `AbortSignal` | proposed |

### Deterministic ordering

Partial results use the same sort orders as complete ones. Only the *cut point* depends on time. Anything that compares or
stores results (determinism digest, manifests, caches) must reject `complete: false`.

### Safe failure

The reader closes descriptors in `finally`. The library performs no writes, so there is nothing to roll back. A thrown
`CANCELLED` leaves no state. Phase 2 manifest writing must check `complete === true` before it starts and must not accept a
deadline at all while writing.

## MCP considerations (Phase 3)

- A deadline cannot interrupt a synchronous call, and a cancellation notification cannot be processed while the event loop is
  blocked. The reliable design is to run scans in a `worker_threads` worker. The server enforces a per-tool timeout by
  terminating the worker (the only hard stop Node.js offers), and the cooperative deadline inside the worker produces a clean
  partial result slightly before that.
- Tool defaults should pass an explicit deadline (for example 10 s) and an explicit pack budget, and should return
  `complete: false` verbatim to the agent so it can decide to narrow the task.
- Because a server scans repeatedly, the cache described in the manifest design (digest-keyed, never time-keyed) is a better
  speed-up than shorter deadlines.

## What is justified now

Implemented: `--max-content-files` / `maxContentFiles`, because the profiled bottleneck (file reads) scales with it and it is
deterministic.

Not implemented: the time deadline and `AbortSignal`. There is no demonstrated hang within default limits, no user of the
cooperative API yet, and adding a non-reproducible path before the manifest design is final would complicate it.
**Trigger to implement:** the start of the MCP phase, or any measured default-limit run that exceeds about 10 s on CI hardware.

## Test plan (when implemented)

- A deadline of 0 ms returns `complete: false` with a prefix of the full index, and the same call with `maxFiles: processed`
  equals it.
- Files already read before expiry keep their analysis; the pack lists the omission.
- Doctor on an incomplete scan never emits absence-based findings.
- `AbortSignal` aborted before the call throws `CANCELLED` and performs no reads.
- Manifest writing refuses `complete: false`.
- The cross-platform digest is unaffected (the digest run uses no deadline).
