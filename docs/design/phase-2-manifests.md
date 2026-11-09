# Design and implementation: persistent context manifests

Phase 2 introduces explicit snapshot persistence. The repository remains the
source of truth. A manifest cannot supply facts or instructions to scan,
context compilation, or doctor.

## Commands

```text
contextanvil manifest create <path> --output <file>
contextanvil manifest verify <path> --manifest <file>
contextanvil manifest diff <path> --manifest <file>
contextanvil manifest update <path> --manifest <file>
```

All commands accept `--json` and the scanner's CLI limit and ignore options.
Pass the same options to compare like with like. Create requires a new target.
Update requires an existing valid manifest and authorizes replacement if the
fresh bytes differ. Both require destinations outside the scanned root so a
generated file cannot become an input to the next snapshot. Verify and diff
are read-only. Verify returns 1 for drift. A completed diff returns 0 even
when it finds changes. Usage errors return 2. Invalid data, storage failures,
and incomplete comparisons return 3. A partial live scan cannot be written.

## Schema 1

Canonical serialization is UTF-8 JSON, two-space indentation, fixed key order,
LF line endings, and one trailing newline. File paths and fact records are
sorted by code unit. Records use these fields in order:

| Object | Fields |
| --- | --- |
| Top level | `format` (contextanvil-manifest), `schemaVersion`, `scanner`, `scan`, `files`, `facts`, `integrity` |
| Scanner | `version`, scanner `schemaVersion` |
| Scan | `respectIgnore`, `limits`, `complete`, sorted warning codes |
| File | canonical repository-relative `path`, `bytes`, full source `sha256` |
| Fact | `id`, `kind`, `status`, `confidence`, ordered `evidence`, `digest` |
| Evidence | `path`, `line` (null if unavailable) |
| Integrity | `sha256` of canonical JSON with the integrity field omitted |

Fact digests fingerprint the scanner's fact records so a change in a claim or
its provenance can be reviewed via live scanning. The persisted record omits
claims, excerpts, arbitrary detector payloads and instruction prose. The file
contains no timestamps, machine paths, or copy of source text. Sensitive paths
are excluded. Serialized metadata is screened with the project's heuristic
secret detector. Review metadata before sharing it.

The parser rejects noncanonical JSON, duplicate or unknown fields, unsupported
manifest versions, invalid paths, non-UTF-8 data, and bad integrity digests.
Read and serialization limits are 16 MiB and 12 nesting levels. Integrity is
an accidental-corruption check. An attacker can compute it for forged data.

Complete means every file admitted by scanner policy was hashable and
traversal and detection completed. Ignore policy, excluded file types and
sensitive-path rules still define the snapshot boundary. Unreadable or
oversized indexed files, unreadable ignore rules, unsafe links and truncation
can produce a partial snapshot. Warning codes can also describe ordinary
detector findings in a complete snapshot. Reported differences against
partial observations cannot establish removals.

## Refresh and invalidation

All commands rewalk, rerun detectors, and hash the live indexed files. A hash
pass reuses reads already made by detectors and avoids decoding or retaining
source text for other files. The old manifest is used only for comparison and
as a write precondition. Changed paths, ignore rules, packages, instruction
documents and scanner configuration are handled by reconstruction. Renames
appear as removal and addition. The no-change refresh skips publication.
Ignore-rule reads and source reads share the snapshot's total byte budget.

Update reports full reconstruction explicitly. Neither a matching timestamp,
a matching size, nor a persisted digest proves the current bytes. This version
offers no persisted read-skipping cache. An incremental change detector must
produce byte-for-byte the same manifest as reconstruction before it can be
enabled. A live scan spans multiple reads, so use a quiescent tree when a
coherent snapshot is needed.

### Measured refresh cost

`node bench/manifest.js 5000` runs fresh processes on the same generated
5,002-file tree. It alternates operation order over four pairs per scenario.
The operating-system cache is uncontrolled and the fixture is primed.
Windows, Node 24.22.2, median results:

| Tree | Operation | Source reads | Source bytes | Time | Peak RSS | Manifest bytes |
| --- | --- | ---: | ---: | ---: | ---: | ---: |
| Unchanged | Create | 5,002 | 611,231 | 1,049 ms | 66.1 MiB | 780,991 |
| Unchanged | Update | 5,002 | 611,231 | 1,082 ms | 73.8 MiB | 780,991 |
| One file edited | Create | 5,002 | 611,232 | 1,077 ms | 65.9 MiB | 780,991 |
| One file edited | Update | 5,002 | 611,232 | 1,125 ms | 77.9 MiB | 780,991 |

The counters count repository content reads, including ignore rules, and
exclude the external manifest. Update parses and validates the old manifest.
The unchanged case skips publication. Neither case reduces source reads.

## Publication and concurrency

The storage layer requires a regular manifest file and an existing parent
whose canonical path does not traverse symlinks. It rejects unsafe file names
and Git metadata destinations. Explicit writes stage a mode-0600 temporary
file in the destination directory and flush it before publishing. Create uses
an atomic no-clobber hard link. Update takes an exclusive sibling lock, checks
the read revision and bytes again, then atomically renames the replacement.
Directory flush is best effort. Filesystems without hard links cannot create
manifests through this interface.

A failed publication leaves an existing manifest intact. A terminated process
can leave temporary files or an update lock. Remove a stale lock only after
confirming no writer is active. Locking coordinates ContextAnvil writers.
If the destination directory identity changes, cleanup avoids unlinking
entries in the replacement directory.
Node's path-based filesystem API cannot provide an atomic compare-and-swap
against arbitrary external writers or hostile parent-directory swaps. Choose
a destination directory controlled by the user.

The reader rechecks containment and file identity and refuses sensitive link
targets. The writer never executes repository code or uses manifest paths as
filesystem references. No command creates directories, modifies ignore rules,
stages Git changes, or contacts an external service.
