# Design: persistent context manifests (Phase 2)

Status: **design only. Nothing in this document is implemented.** It is written to be reviewed, challenged and, if accepted,
turned into an ADR before any code is written.

## 1. Goals and non-goals

**Goals**

1. Let a person record, review and share *what ContextAnvil believes about a repository*, as a file, at a moment they choose.
2. Make changes reviewable: "which facts changed between these two states?" (diff).
3. Make repeated scans cheap on large repositories (incremental updates).
4. Do all of it without ever modifying a repository implicitly and without trusting a file just because it is in the repository.

**Non-goals** (each is a deliberate cut)

- No background daemon, file watcher, git hook or automatic regeneration.
- No generation or editing of `AGENTS.md` / `CLAUDE.md` in this design (that is a later, separate step that will depend on this one).
- No signing or authentication of manifests (an integrity digest is included; it is not a signature, see 8).
- No network, database or cloud storage.
- No change to the output of `scan`, `context` or `doctor` unless the user explicitly points them at a manifest.

## 2. Principles that constrain everything

| Principle | Consequence |
| --------- | ----------- |
| Explicit creation | Exactly one command writes a manifest, and the user names the output path. No default location is ever written. |
| Read-only by default | `scan`, `context`, `doctor` and `diff` never write. Tests assert the scanned tree is byte-identical afterwards. |
| A manifest is data, not authority | It may come from a pull request or a stranger. It is validated, bounded, neutralised and never used to decide what is true (section 7). |
| Determinism | The same repository state produces the same manifest bytes on every OS and Node.js version; CI checks this the way it checks the scan digest today. |
| Partial results are never persisted | A scan with `complete: false` (see `deadlines-and-partial-results.md`) cannot be written. |

## 3. Commands (proposed)

```text
contextanvil manifest create [path] --output <file> [--force] [--include-sensitive-paths]
contextanvil manifest verify <file> [path]            # compare a manifest with the repository now; read-only
contextanvil manifest migrate <file> --output <file>  # write an upgraded copy; never in place
contextanvil diff <manifest-a> <manifest-b>           # or: contextanvil diff <manifest> --live [path]
```

- `--output` is **required** for `create`. There is no `--init` that picks a spot. The help text may *suggest* a path; it never
  chooses one.
- `verify` and `diff` read only. `diff --live` scans the repository (read-only) and compares.
- Possible later flags (not designed here): `context --manifest <file>` (see 7 for what it would and would not do).

## 4. File format (schemaVersion 1)

A single JSON document, canonical form: UTF-8, LF line endings, 2-space indent, object keys in a fixed documented order,
arrays sorted by the same code-unit comparator the scanner uses, one trailing newline. Canonical form is what makes the bytes
deterministic and diffs meaningful.

```jsonc
{
  "format": "contextanvil-manifest",
  "schemaVersion": 1,
  "generator": { "name": "contextanvil", "version": "0.3.0" },   // informational; not used for compatibility
  "repository": {
    "name": "shop",                       // basename only: no absolute paths, no user names
    "vcs": { "head": "8ea9cbd..." }       // optional; read statically from .git (no git subprocess); omitted if unknown
  },
  "scan": {
    "complete": true,                     // must be true to be written
    "limits": { "maxFiles": 20000, "maxDepth": 25, "maxFileBytes": 524288, "maxDirEntries": 20000, "maxTotalReadBytes": 67108864 },
    "stats": { "filesIndexed": 74, "excluded": { "ignored": 3, "defaultDirs": 1, "sensitive": 1, "binary": 0, "symlinks": 0, "unreadable": 0 } }
  },
  "files": [ { "path": "package.json", "size": 1042, "sha256": "..." } ],       // every indexed, readable file; full 64-hex digest
  "facts": [ { "id": "framework:react", "kind": "...", "claim": "...", "status": "...", "confidence": "...",
               "evidence": [ { "path": "package.json", "line": 14 } ], "freshness": { "sha256": "...", "bytes": 1042 }, "data": {} } ],
  "documents": [ { "path": "AGENTS.md", "scope": "", "sha256": "...", "estimatedTokens": 762, "sections": [ { "title": "...", "startLine": 8, "endLine": 15 } ] } ],
  "diagnostics": [ { "level": "warn", "code": "multiple-lockfiles", "path": "package.json" } ],
  "sensitiveFiles": { "count": 1 },      // paths only with --include-sensitive-paths
  "integrity": { "algorithm": "sha256", "digest": "..." }   // of the canonical document without this field
}
```

What is **not** stored:

- instruction-file text (it stays in the repository; storing it would duplicate content, risk secrets, and invite the manifest
  being read instead of the file);
- file contents of any kind;
- absolute paths, user names, timestamps, host names or anything else that varies between machines (determinism and privacy);
- the diagnostics' free-text messages beyond a code and path (messages are regenerated; they may quote nothing from files anyway).

Size: `files` dominates (about 100 bytes per file, 2 MB at the 20,000-file limit). A hard cap of 16 MiB applies when reading.

## 5. Source hashes, staleness and incremental updates

### Source hashes

Every readable indexed file has a full SHA-256 in `files`. Each fact's `freshness` keeps pointing at its primary source. A fact is
**stale** if the hash of any file in its evidence differs from the repository now, or the file is gone.

### Incremental updates: correctness first

The invariant, tested by property: **an incremental update produces exactly the manifest a full scan would.** If that cannot be
guaranteed for some case, the case falls back to a full scan. Speed is never allowed to change the answer.

Two tiers, because the cost of a scan is dominated by reading files (`docs/performance.md`):

1. **Verification mode (always correct).** Re-walk the tree (cheap), compare `(path, size)` against the manifest, re-read and re-hash
   only files that are new or whose size differs, **and** any file whose hash cannot be trusted (see tier 2). Same-size edits are
   caught only if every file is re-hashed, so verification offers `--verify full` (re-hash everything; the default for `create` and
   for CI) and `--verify fast`.
2. **Fast mode uses a local cache that is never committed.** `--verify fast` consults `(size, mtime)` from a cache file the *user
   names* (`--cache <file>`), kept outside the repository by convention. A matching size and mtime lets a file be treated as
   unchanged. mtime is a heuristic (it can be reset, and checkouts rewrite it), which is exactly why it is confined to an explicit,
   opt-in, local cache and never written into the shareable manifest. Fast mode prints that it is a heuristic.

Detectors are cheap relative to reading. On any change, the design re-runs all detectors over the (partly cached) file contents rather
than trying to patch individual facts. That keeps "incremental == full" simple to prove. Per-detector dirty tracking is a later
optimisation only if profiling justifies it.

### Removals and renames

A path present in the manifest and absent now is **removed**; renames are reported as remove plus add (git's rename detection is not
available without running git, which the design avoids).

## 6. Diff

`diff` compares two manifests (or a manifest and the live tree) and reports, in a fixed order:

1. repository-level changes (`head`, limits, completeness, generator version);
2. files added, removed, changed (by hash);
3. facts added, removed, changed (matched by `id`; a change lists which of claim, status, confidence, evidence hashes differs);
4. instruction documents added, removed, changed, with section-level differences by title and line range;
5. diagnostics added and removed.

Output: text (ASCII, like the rest of the CLI) or `--json`. Exit code 0 if identical, `1` with `--fail-on-change`, otherwise 0.
Everything displayed is neutralised and redacted exactly as scan output is, because manifest strings are untrusted input
(section 7). Diff is purely a function of its inputs: no clock, no filesystem writes.

## 7. Untrusted and stale context

A committed manifest is attractive to an attacker: it looks authoritative and agents may read it. Rules:

1. **Facts from a manifest are never fed to an agent as truth.** A forged manifest can claim any `claim` text next to a real file
   hash. Therefore `scan`, `context` and `doctor` always derive facts from the repository. A manifest is used for exactly three things:
   *diffing*, *verifying* ("is this manifest still accurate?") and, with an explicit cache, *skipping unchanged reads*. In the cache
   case only hashes and sizes are consulted, never a cached claim.
2. **Parsing is hostile-input parsing.** Size cap, depth cap, strict schema: unknown keys are rejected unless prefixed `x-`; all strings
   have maximum lengths; `path` values pass `normalizeRelative` (no absolute paths, no `..`) and are never used to touch the
   filesystem except through the indexed-file reader; numbers must be integers in range; the `integrity` digest must match.
3. **Staleness is reported, not hidden.** `verify` lists every changed, added and removed file and every stale fact. If a future
   command ever shows manifest-derived information, each item carries `stale` or `fresh` computed against the repository at that moment.
4. **Version skew.** A manifest from a newer major `schemaVersion` is refused with a clear message; an older supported one is read (and
   can be migrated). Generator version is displayed but never decides compatibility.
5. **No secrets.** Manifests are built from already redacted facts. As defence in depth the serialised document is scanned with
   `findSecrets` and writing aborts if anything is found. Sensitive-file paths are omitted by default (a committed list of credential
   file names is itself information).

## 8. Integrity, and what it is not

`integrity.digest` is a SHA-256 of the canonical document, which catches truncation and accidental edits. It is **not**
authentication: anyone can recompute it after editing. Do not describe it as signing. If provenance matters, sign the file with the
tool the project already uses for commits or releases (out of scope here).

## 9. Atomic, careful writes

`manifest create` is the only operation that writes, and it writes only the single path the user gave.

1. Resolve the output path. Refuse if its parent directory does not exist (no implicit `mkdir -p`), if the path is a directory, if
   it is a symlink (checked with `lstat`), or if it lies inside `.git/`.
2. Refuse to overwrite an existing file unless `--force` is given. Without it, create the temporary file exclusively (`O_EXCL`).
3. Build and serialise the complete manifest in memory first. If the scan is incomplete, or serialisation or the secret check fails,
   write nothing.
4. Write to a temporary file **in the same directory** (`<name>.tmp-<pid>-<random>`, mode `0644`, never executable), flush it with
   `fsync`.
5. `rename` over the target (atomic on one volume; replaces an existing file on Windows through the same call), then `fsync` the
   directory where the platform supports it.
6. On any failure, remove the temporary file (best effort) and leave any existing target untouched. A crash can leave a stray
   `*.tmp-*` file but never a half-written manifest at the target path.

Concurrent writers: the last rename wins and each result is a complete file; no locking is attempted because the guarantee that
matters is "never a torn file".

The command prints exactly what it wrote and where. It never edits `.gitignore`, never stages anything in git, and never writes
outside the named path; if the file would be picked up by version control the output *suggests* a `.gitignore` line and does nothing
about it.

## 10. Compatibility and migrations

- `schemaVersion` is a single integer. Additive, optional fields keep the number; anything that changes meaning, removes a field or
  tightens validation bumps it.
- The reader supports the current version and the previous one. Older versions get a documented upgrade path through
  `manifest migrate`, which **writes a new file and never modifies the input**; downgrades are refused.
- Every released schema is documented under `docs/schemas/` and a **golden manifest per version is committed as a test fixture and read
  forever**. A change that breaks reading a golden file is a breaking change by definition.
- `format` is checked first so that unrelated JSON is rejected with a useful message.

## 11. "No implicit repository modification", made testable

- Test: hash the entire fixture tree before and after `scan`, `context`, `doctor`, `diff`, `manifest verify` and `manifest migrate`
  (output elsewhere); it must not change. For `manifest create`, the only difference is the one named file.
- Test: `manifest create` with an existing target and no `--force` leaves it byte-identical; with `--force`, a simulated failure in the
  write step leaves the old file intact (inject a failing `rename`).
- Test: no command creates a directory, a `.contextanvil` folder, a cache or a lock file unless a path for it was passed explicitly.
- Static check (extends the existing grep in `docs/security.md`): the only `fs` write calls in `src/` live in one module
  (`src/manifest/write.js`), reviewed as a unit.

## 12. Acceptance criteria

1. CI is green on 3 operating systems x Node 22, 24 and the current LTS, **including** a manifest digest identical across all nine
   (extending `bench/digest.js`).
2. Property test: for random edit sequences over the fixture repositories (modify, add, delete, rename, same-size edit), incremental ==
   full, byte for byte.
3. The hostile-input suite for manifests passes: oversized file, deeply nested JSON, wrong types, path traversal in `path`, control and
   invisible characters, forged integrity, unknown keys, future `schemaVersion`.
4. Atomic-write tests above pass, including the injected failure.
5. The `docs/security.md` guarantees are restated for the new command with the single-write-module check.
6. `diff` output is deterministic and neutralised (tested with hostile strings).
7. Partial scans are refused (once deadlines exist; until then `complete` is always true).
8. A golden `schemaVersion: 1` manifest is committed and read by the test suite.
9. An independent evaluation (new frozen labels; the external set is spent) shows no ranking regression, because Phase 2 must not
   change ranking.

## 13. Open questions

- Is a full-hash manifest acceptable at 20,000 files (about 2 MB, one full read pass), or should large repositories get a
  hash-the-cited-files-only mode? Needs measurement on Linux/macOS CI, not on this machine.
- Should `repository.vcs.head` exist at all? It makes manifests tied to a commit, which helps review and hurts byte-for-byte
  reproducibility across a rebase. Proposal: optional, off unless requested.
- Where should the local cache live by convention (user cache directory, not the repository)? Needs a decision that respects the
  "no implicit directories" rule.
- Should `context --manifest` exist at all given section 7? Proposal: not in Phase 2.
