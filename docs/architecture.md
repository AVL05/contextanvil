# Architecture

ContextAnvil turns a repository into **facts with provenance**, then compiles a **bounded, task-focused
context pack** from those facts. Everything is deterministic and local: no network, no model calls, no
execution of repository code.

```text
                  repository on disk (read-only)
                              |
              +---------------v----------------+
              |  core: walker, ignore, reader  |  safe, bounded file access
              +---------------+----------------+
                              |  file index + safe reader
              +---------------v----------------+
              |  detectors (one module each)   |  languages, node, php, config,
              |                                |  structure, conventions, instructions
              +---------------+----------------+
                              |  facts, documents, diagnostics
                    +---------v----------+
                    |  scanner.js        |  ScanResult (plain JSON-able data)
                    +----+----------+----+
                         |          |
          +--------------v--+   +---v-----------+
          |  compiler       |   |  doctor.js    |
          |  context pack   |   |  findings     |
          +--------------+--+   +---+-----------+
                         |          |
                    +----v----------v----+
                    | render / cli       |  text, Markdown, JSON, exit codes
                    +--------------------+
```

The only public entry point is `src/index.js`. A CLI, an MCP server and a dashboard are all thin
presentation layers over the same three functions: `scanRepository`, `compileContext` and `diagnose`.
`test/api.test.js` pins the exported names and the shape of every result.

## The fact model

A fact is the unit of knowledge (`src/core/facts.js`).

| Field        | Meaning                                                                                  |
| ------------ | ---------------------------------------------------------------------------------------- |
| `id`         | Stable identifier, for example `framework:react` or `script:test`.                      |
| `kind`       | `language`, `framework`, `tool`, `test-framework`, `package-manager`, `manifest`, ...    |
| `claim`      | One human-readable sentence. Redacted and neutralised.                                   |
| `status`     | `observed` (read from a file) or `inferred` (deterministic heuristic over observations). |
| `confidence` | `high`, `medium` or `low`.                                                               |
| `evidence`   | List of `{ path, line?, excerpt? }`. The first entry is the primary source.             |
| `freshness`  | `{ sha256, bytes }` of the primary source file at scan time.                             |
| `data`       | Structured payload for programmatic use (strings redacted and neutralised).              |

"Freshness" is a **content digest**, not a timestamp. File modification times change on every git
checkout, so using them would make output differ between machines. Digests let a later run (Phase 2)
decide whether a fact's source has changed.

Facts are never fabricated. A detector emits a fact only when it can cite a file. Where a conclusion
needs a heuristic (for example "tests are named `.test.`"), the fact is marked `inferred` and carries the
counts it was derived from. A directory name alone never yields a role: `app/Http/Controllers` is
reported as "Laravel controllers" only because a Laravel dependency was also observed, and then as
`inferred`/`medium`.

## Layers

### `src/core`: safe access

- **walker**: breadth-first, deterministic traversal. Dependency, build and cache directories are never
  entered. `.gitignore` and `.contextanvilignore` (nested, with negation) are honoured, but only if they are
  regular files inside the root. Directory symlinks are never followed; file symlinks are indexed only when
  their real target is inside the root. Sensitive files are listed by path but never opened. Names containing
  control or invisible characters are skipped and reported in escaped form. Limits: file count, depth, entries
  per directory, file size, total bytes read.
- **reader**: the only way file contents are read. It serves only paths that are in the walker's index,
  re-checks the real path against the root immediately before opening, opens with `O_NOFOLLOW` where available,
  re-verifies the descriptor's identity and real location after opening, enforces size and binary limits, and
  hashes content. Strings that come from repository text (such as a path quoted in `AGENTS.md`) can therefore
  never reach the filesystem unless they name an indexed file.
- **ignore**: a gitignore-compatible matcher with no dependency. Patterns are hostile input, so they are matched
  segment by segment with an iterative glob matcher; they are never compiled to regular expressions.
- **secrets**: sensitive-path rules and `redact()` / `findSecrets()`. Every pattern is bounded.
- **sanitize**: replaces control characters (including terminal escape sequences) and invisible or
  direction-changing characters with visible `<U+XXXX>` markers. Applied to every fact, instruction excerpt and
  payload string that originates in a scanned file.
- **facts, markdown, classify, paths**: the fact model, line-aware Markdown sections, file categories and
  path normalisation (forward slashes everywhere, code-unit sorting).

### `src/detectors`: evidence extraction

Each detector is `{ id, detect(ctx) }`. It receives a context with `read`, `readJson`, `readJsonc`,
`lineOf`, `jsonLine` and `addFact`, and nothing else. It cannot execute code or touch the filesystem
directly. To support a new ecosystem, add a module and register it in `src/detectors/index.js`.

| Detector       | Produces                                                                                    |
| -------------- | ------------------------------------------------------------------------------------------- |
| `languages`    | Languages by extension, with counts.                                                        |
| `node`         | package.json: frameworks, tools, test frameworks, package manager, scripts, entry points.   |
| `php`          | composer.json: Laravel and friends, PSR-4 mappings, scripts, Laravel entry points.          |
| `config-files` | Important configuration files (TypeScript, ESLint, Prettier, Docker, CI, agent config, ...). |
| `structure`    | Significant source directories, with a role only when independently corroborated.           |
| `conventions`  | EditorConfig, Prettier, tsconfig, test naming/layout, file naming style.                    |
| `instructions` | AGENTS.md, CLAUDE.md, Copilot, Cursor, Gemini, Windsurf instruction files, split into sections; control and hidden characters neutralised. |

Configuration that would require running code (`prettier.config.js`, `eslint.config.js`, `next.config.js`)
is recorded as present but never evaluated.

### `src/compiler`: task-aware selection

`compileContext(scan, task, { budget, top })`. Everything below is deterministic and uses no model, embedding
or external service. Rationale and rejected alternatives: [ADR 0002](decisions/0002-relevance-ranking.md).

1. **Terms and intent** (`terms.js`). The task is lower-cased, split on identifiers, stripped of generic words
   and verbs, and lightly stemmed. Paths named in the task that exist in the index are recorded. A *task
   intent* is classified by transparent keyword rules (first match wins, in this order): `docs`, `fix`, `test`,
   `refactor`, `build`, `add`; otherwise `modify`. The intent only changes how much each *kind* of file counts.
2. **Analysis** (`analyze.js`). Candidate files are read through the safe reader, in path-relevance order and up
   to a bounded count. For each: declared symbols (functions, classes, top-level constants, PHP classes and
   methods), resolved imports, and per-term occurrence counts. File text is not retained. Imports are resolved
   for JavaScript/TypeScript (relative paths and `tsconfig`/`jsconfig` aliases) and for PHP (`use` statements and
   same-namespace references through the composer PSR-4 map, plus Laravel `view()` calls to Blade files).
3. **Scoring** (`relevance.js`). Additive, with a stored reason for every point:

   | Signal | Exact | Prefix | Root |
   | ------ | ----- | ------ | ---- |
   | File name token matches a term | +4 | +2.5 | +2 |
   | Directory name token matches a term | +1.5 | +1 | +0.8 |
   | Declared symbol token matches a term | +3 | +2 | +1.5 |

   "Prefix" means `nav` / `navigation` (a 3-letter abbreviation of a word at least 2.5 times longer, or a
   4+ letter prefix); "root" means a long shared beginning (`detection` / `detectors`). `app` / `apply` do not
   match.

   Location points are multiplied by a **term weight** between 1 and 2.5,
   `1 + 0.5 x log10((files + 1) / (files matching + 1))`, so a term found in few files outweighs one found
   everywhere. Further signals:

   - content mentions: 1 point per term (1.5 with 3+ occurrences) times the weight, at most 3 per file;
   - +1 for each extra distinct term the file matches;
   - +1.5 per task word that names the file's structural role (at most two words), where the role comes from
     the path (`resources/views`, `Controllers`, `Policies`, `Mail`, `Jobs`, ...; see `roles.js`). A role alone
     never creates a match;
   - +1.5 times the weight for each *distinctive* term (found in at most 20% of files) the file contains,
     counted only when the file also matches another term;
   - +10 for a file named in the task.

   The total is multiplied by an **intent factor** per file category (source, test, documentation,
   configuration), for example `docs`: documentation x1.6, tests x0.3; `test`: tests x1.5. The full table is
   `INTENT_WEIGHTS` in `terms.js`.
4. **Relations** (second pass, from the three strongest candidates). A test of a top candidate (same base name
   or importing it) +1.5; a direct importer +1; a direct dependency +0.5 (the last two only for files that
   already match); at most +2 in total. For `add` tasks, a *registry* (a module importing three or more siblings
   from its own directory) whose directory or whose members match gets +2 as the extension point for additions.
5. **Instructions**. Instruction documents apply by directory scope. Sections are chosen by heading or body
   match, with a small set of general sections (commands, testing, conventions, structure) as baseline.
6. **Packing**. Items are packed in priority order into the budget. The result is rendered, measured, and
   trimmed until it fits; the reported usage is the measured size of the final text.

Ties break on path order and scores are rounded to two decimals. The pack records the intent, each term's weight
and document frequency, and the reasons for every listed file, so a ranking can always be audited
(`contextanvil context "<task>" --json`).

**Known weaknesses.** The ranker is lexical plus structural. It does not understand synonyms ("euros" does not
lead to a file that says `currency`), cannot infer domain knowledge ("discount" implies "pricing"), and treats a
domain noun that appears in most file names (such as "order" in an order-management app) as weak evidence.
Relation evidence is limited to JavaScript, TypeScript and PHP. Measured accuracy is in
[bench/README.md](../bench/README.md).

**Honest budgets.** There is no tokenizer. The budget is a limit on UTF-8 bytes; token figures are
`ceil(bytes / 4)` and are always labelled "estimated". Within a budget, a ranked section never lets a
lower-ranked item displace a higher-ranked one; a file that does not fit in full may be shortened to its
path and score, and every shortening or drop is listed under **Omissions**.

**Facts versus recommendations.** Facts carry `observed` or `inferred` and a source. Recommendations
("run the test script after changing these files") are a separate list, always `inferred`, and always cite
what they were derived from.

### `src/doctor.js`: diagnostics

Checks are grouped as *missing* (no instructions, empty or oversized files), *conflict* (different package
managers, lockfile mismatch, duplicate files), *stale* (referenced scripts or paths that do not exist,
manifest entry points that do not exist), *unsafe* (secrets, terminal control characters, hidden characters,
hidden HTML and comments, encoded blobs, hijacking phrases, sensitive files, install-time scripts, agent hooks
and MCP configuration) and *scan* (limits that reduced coverage). Stale detection is by **broken references**,
not by guessing from age. Suspicious phrases are reported as data to review; they are never executed or obeyed.
A phrase is not reported when a negation in the same clause forbids the behaviour ("never ignore previous
instructions").

## Determinism

For unchanged inputs, every output is byte-identical: breadth-first traversal over code-unit-sorted names,
no timestamps, no randomness, no locale-dependent comparison, scores rounded to two decimals, ties broken by
path. Tests verify this, including that a copy of a repository in a different location produces the same
facts. CI additionally computes a digest of the complete output for all benchmark repositories on every
operating system and Node.js version and fails if any two differ (`bench/digest.js`). That cross-platform check
ran green on GitHub Actions on Ubuntu, macOS and Windows with Node.js 22, 24 and 26 (see the README).

## Performance and limits

Scanning is synchronous. Defaults: 20,000 files, depth 25, 20,000 entries per directory, 512 KiB per file,
64 MiB read in total, 5,000 files read for symbol and content matching (`--max-content-files`). Real-path resolution uses one native system call; compile time is dominated by file reads (`docs/performance.md`). When a limit is hit the result says so;
it is never silent. There is no wall-clock limit. Measured timings and memory are in
[bench/README.md](../bench/README.md); see `docs/roadmap.md` for planned incremental scanning.

## Extending

- **New ecosystem**: add a detector module; emit facts through `ctx.addFact` with evidence.
- **New ignore or sensitivity rule**: `src/core/walker.js`, `src/core/secrets.js`, with a test.
- **New doctor check**: add it to `src/doctor.js` with an id, severity, category, evidence and a test.
- **Any regular expression applied to repository text** must be bounded, and needs an adversarial case in
  `test/security.test.js`.
- **New front end** (MCP, dashboard): import from `src/index.js`. Results are plain JSON-serialisable data with
  a `schemaVersion`.
