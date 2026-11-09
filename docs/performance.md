# Performance investigation (Phase 1.2)

Question: why did compiling a context for a 5,002-file generated repository go from about 0.7 s (v0.1.0) to about 2.3 s
(v0.1.1) in the Phase 1.1 benchmark, and what can be done without changing which files are ranked?

All numbers: Windows 11, Node.js 24.22.2, 16-thread laptop CPU with real-time antivirus scanning, one machine. They
describe relative cost, not what other machines will see. Reproduce with `node bench/profile.js 5000`.

## Method

`bench/profile.js` generates a repository, scans it, and runs the same compile three times in one process. The first
compile is **cold** (every file is read from disk for the first time since it was written); the later ones are **warm**
(ContextAnvil's reader has the contents cached), so the warm number isolates CPU work. Three engines were run interleaved,
five times each, to spread background noise evenly: the frozen v0.1.0 engine, the Phase 1.1 commit (`8ea9cbd`) and the
current code.

## Findings

| Engine | Cold compile, median of 5 (range) | Warm compile | Scan |
| ------ | --------------------------------- | ------------ | ---- |
| v0.1.0 | 4.3 s (3.5 to 4.7) | 49 ms | 131 ms |
| Phase 1.1 commit | 5.5 s (5.2 to 6.2) | 96 ms | 158 ms |
| current | 4.8 s (2.9 to 5.5) | 100 ms | 124 ms |

1. **Almost all of the time is reading files, not computing.** Warm compile (all CPU work: tokenising the task, scoring, symbol
   and import extraction, relations, rendering) is 100 ms for 5,000 files. The cold run is 30 to 60 times longer. On this
   machine the first read of a newly written file is slow (antivirus inspection), and the cold figures also vary widely
   between runs (2.9 to 5.5 s for identical code). Cold timings on a repository whose files have been read before are far
   lower: the two private real repositories (357 and 695 files) compile in 110 and 267 ms.
2. **The 0.7 s to 2.3 s jump in the Phase 1.1 benchmark had two causes, both I/O**: v0.1.1 reads up to 5,000 files for content
   matching where v0.1.0 read 2,000 (2.5x as many reads), and each read became more expensive (below). The CPU part of the
   increase is about 50 ms.
3. **Per-read cost: the hardening added two `fs.realpathSync` calls per file** (the pre-open check and the post-open
   identity check). Node's JavaScript implementation does one `lstat` per path component. Microbenchmark, 5,002 files: JS
   `realpathSync` 950 ms, `realpathSync.native` 290 ms (one system call). The v0.1.1 read sequence was 2.07 s, of which about
   1.85 s was those two calls.

## What changed

- **All real-path resolution now uses `fs.realpathSync.native`** through one helper (`realpath` in `src/core/paths.js`),
  including the scan root and the walker's directory checks, so comparisons stay consistent (the two implementations can
  disagree on letter case on Windows). The hardening is unchanged: still two checks per read, now at about a third of the
  cost. Cold compile improved from a median of 5.5 s to 4.8 s (about 13%, within the noise range of the measurement).
- **Markdown output is less verbose; JSON is not.** Each listed file shows its four strongest reasons (the JSON keeps all of
  them), three related files, and a shorter term line. Default pack sizes fell 5% to 6% against the Phase 1.1 commit
  (4,932 / 5,092 / 3,976 / 8,613 bytes against 5,246 / 5,383 / 4,207 / 9,022). Against v0.1.0 they are still -1%, +18%, +4% and
  +3%. Rankings and default-pack recall are identical to before.
- **`--max-content-files <n>`** (API: `maxContentFiles`) is a deterministic way to trade matching quality for speed on huge
  repositories; files not read are matched by path only and the omission is reported.

## Not done, and why

- Reading fewer files by default. That changes rankings (a file mentioned only in its content, such as the dependency list
  that names a framework, would be missed), so it needs an evaluation set, not a guess. The new knob lets users decide.
- Asynchronous or parallel reads. Sensible once a server needs them (see `docs/design/deadlines-and-partial-results.md`);
  whether sequential synchronous reads are the bottleneck on a machine without antivirus interference is unmeasured; this machine has it.
- Skipping the post-open check. That would remove most of the remaining per-read overhead and also the race hardening.
- Linux and macOS timings. CI uploaded no timing data (the benchmark job asserts quality and determinism only).

## Terms, imports, `findRelated` and rendering

These were asked about explicitly. All of them are inside the **warm** figure: about 100 ms in total for 5,000 files (49 ms
in v0.1.0). That covers task tokenising, scoring every file against every term, the symbol and import extraction that happens
in the single read pass, relation boosts, `findRelated` (one linear pass per listed file) and rendering. I did not profile
inside those 100 ms: they are small next to the I/O, and a CPU profile of the compile on this machine is dominated by
file-system calls. The warm cost grew by about 50 ms between v0.1.0 and v0.1.1 (more signals, PHP imports, role and relation
passes). It would matter only at roughly 100,000 files, which the default 20,000-file limit rules out. A profile inside the
warm phase should be taken if that limit is ever raised.
