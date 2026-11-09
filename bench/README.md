# Benchmarks

This directory measures four things about ContextAnvil, reproducibly:

1. **Ranking accuracy**: does `context "<task>"` put the files a developer needs at the top?
2. **Context size**: how large is the pack, compared with the repository's text?
3. **Speed and memory**: scan and compile time, peak memory.
4. **Determinism**: are the outputs byte-identical across runs and processes (and, in CI, across operating systems)?

**Read this first: the benchmark in this file is optimistic.** Its labels were written by the author of the ranker. A second
evaluation with labels taken from real commit history, frozen before it was run, gives much lower numbers (MRR 0.43 against 0.92
on the synthetic repositories here); see [external/RESULTS.md](external/RESULTS.md). Believe the external numbers when they
disagree with these.

**What this does not measure.** Nothing here involves a language model. These benchmarks say how well
ContextAnvil *finds relevant files*. They say **nothing** about whether an AI agent gets better answers, uses fewer
tokens, finishes faster or costs less when given a ContextAnvil pack. Those claims need agent-based experiments
(roadmap Phase 5) and none have been run. Token figures anywhere in this project are estimates (`bytes / 4`).

## Run it

```bash
npm run bench:quick        # ranking quality only, a few seconds
npm run bench              # full run: quality + timing + memory + determinism -> bench/results/latest.{json,md}
npm run bench:digest       # output digest used by CI to compare operating systems
node bench/profile.js 5000  # cold and warm compile time on a generated repository
node bench/external/evaluate.js --repo ...   # frozen external labels; see bench/external/README.md
node bench/explain.js shop-next sn-nav-hamburger   # why did the ranker order files this way? (dev tasks only)
node bench/run.js --engine /path/to/other/src/index.js --label "other build"   # same harness, another build
node bench/compare.js bench/results/baseline-v0.1.0.json bench/results/after-v0.1.1.json
```

`BENCH_LOCAL_REPOS` (a `;`- or `:`-separated list of directories) adds timing-only measurements of private
repositories to the performance section. Nothing about their contents is stored; they appear as `local-1`, `local-2`.

## Datasets (`bench/datasets/tasks.json`)

| Dataset | Kind | Files | Tasks | What it is |
| ------- | ---- | ----- | ----- | ---------- |
| `shop-next` | synthetic | 43 | 10 | Next.js App Router storefront, TypeScript, `@/` path aliases, Vitest and Playwright |
| `orders-laravel` | synthetic | 37 | 8 | Laravel order management: PSR-4, services, policies, mail, Blade views, PHPUnit |
| `plugin-cli` | synthetic | 31 | 8 | Node ESM linter with a rule registry, parsers and reporters |
| `contextanvil-0.1.0` | real | 57 | 8 | This project, frozen at v0.1.0 (`bench/snapshots/`) |

"Synthetic" repositories (`bench/fixtures/*.bundle`) are small hand-written projects shaped like real ones. They are
realistic in structure and naming, but they are written by the same person who wrote the ranker, are tiny, and
contain far fewer distractors than a real codebase. "Real" is a genuine project, but it is also the author's own, and
the author also wrote its labels. The two kinds are always reported separately. Results on neither kind should be
read as a statement about repositories in general.

Each task lists the files a developer would need to read or modify. Sets are small (1 to 4 files).
Files a task would *create* cannot be listed, so those tasks list the existing registries, templates and callers that
would be edited.

**Splits.** Tasks are tagged `dev` or `holdout`. Ranking changes were tuned on `dev` tasks only, with constants chosen
by an ablation over `dev` results. `holdout` tasks exist to check that improvements generalise. **Disclosure:** the very
first baseline run printed every task's result, so the baseline ranker's holdout failures were seen once before any
change. The holdout is therefore not perfectly blind. After that the runner hid per-task holdout rows (`--show-holdout`
reveals them) and changes were designed from dev failures and general principles.

**Snapshot.** `contextanvil-0.1.0.json` is a frozen copy of the Phase 1 repository so results do not drift as the project
changes. Two README lines that discussed the "Add Vue detection to the scanner" ranking example were removed
(`make-snapshot.js --drop`) so documentation could not leak the answer. Nothing else was changed.

## Metrics

For each task the full ranking (top 50, budget not limiting) is compared with the labelled set:

- **P@K**: share of the top K files that are relevant (K = 1, 3, 5). With 1 to 4 relevant files, P@3 and P@5 cannot reach 1.0.
- **R@K**: share of the relevant files found in the top K (K = 3, 5, 8).
- **MRR**: mean of 1 / rank of the first relevant file.
- **R-precision**: precision at K = number of relevant files. 1.0 means every relevant file is ranked above every other file. This is the strictest and most comparable number across tasks.
- **Pack recall**: share of relevant files present in the pack produced with the *default* budget (3000 estimated tokens).
- **Pack bytes**: size of that default pack, next to the text size of the repository.

Averages are macro-averages over tasks. With 8 to 26 tasks per row, a difference of a few hundredths is noise.

## Results

The recorded runs are in `bench/results/` (`baseline-v0.1.0.*` is v0.1.0 as delivered, `after-v0.1.1.*` is this
version, `comparison.md` lines them up; raw JSON includes the per-task detail). Run on Windows 11, Node.js 24.22.2, a
16-thread laptop CPU. Timings are from one machine and are indicative only.

### Ranking quality

| Set (tasks) | Metric | v0.1.0 | v0.1.1 | Change |
| ----------- | ------ | ------ | ------ | ------ |
| synthetic, all (26) | P@1 | 0.65 | 0.85 | +0.19 |
| | MRR | 0.79 | 0.92 | +0.12 |
| | R@3 | 0.66 | 0.72 | +0.07 |
| | R-precision | 0.56 | 0.70 | +0.14 |
| synthetic, holdout (13) | MRR | 0.75 | 0.87 | +0.12 |
| | R-precision | 0.51 | 0.69 | +0.18 |
| real, all (8) | P@1 | 0.25 | 0.75 | +0.50 |
| | MRR | 0.53 | 0.79 | +0.26 |
| | R@3 | 0.40 | 0.54 | +0.15 |
| | R-precision | 0.40 | 0.42 | +0.02 |
| real, holdout (4) | MRR | 0.50 | 0.59 | +0.09 |
| | R-precision | 0.29 | 0.21 | **-0.08** |

Across all 34 tasks, R-precision improved on 10, was unchanged on 22 and got worse on 2. The real-repository holdout
R-precision went *down* (four tasks, so one task moving is 0.06); MRR, P@1 and recall at 8 on the same tasks went up. The
v0.1.0 weakness that motivated this work ("Add Vue detection to the scanner": the right module ranked 4th) now
ranks the module 1st, but see below for what that does and does not show.

### Context size

Mean size of the default-budget pack (3000 estimated tokens, i.e. up to 12,000 bytes) against the text in the repository:

| Dataset | Repository text | Pack, v0.1.0 | Pack, v0.1.1 | Pack as share of repository text |
| ------- | --------------- | ------------ | ------------ | --------------------------------- |
| shop-next | 14.2 KiB | 4,979 B | 5,246 B | 36% |
| orders-laravel | 8.7 KiB | 4,323 B | 5,383 B | 60% |
| plugin-cli | 7.3 KiB | 3,840 B | 4,207 B | 56% |
| contextanvil-0.1.0 | 250 KiB | 8,375 B | 9,022 B | 4% |

Two honest observations. On small repositories a pack is a large fraction of all the text, so the pack is not a saving
there. And packs got **larger** in v0.1.1 (by 5% to 25%): they now state the task intent and each term's weight and
document frequency, and list more reasons and relations. This section is a statement about output size only; it does not
follow that an agent is better or worse off.

### Speed and memory (this machine)

| Repository | Files | Scan (median) | Compile (median) | Peak RSS, fresh process |
| ---------- | ----- | ------------- | ---------------- | ----------------------- |
| fixtures and snapshot | 31 to 57 | 9 to 20 ms | 10 to 23 ms | about 50 MB |
| generated | 502 | 43 ms | 251 ms | 56 MB |
| generated | 2,002 | 78 ms | 1.0 s | 73 MB |
| generated | 5,002 | 119 ms | 2.3 s | 98 MB |
| private real repo (357 files) | 357 | 50 ms | 110 ms | 66 MB |
| private real repo (695 files) | 695 | 88 ms | 267 ms | 72 MB |

**Regression to be aware of.** v0.1.1 compiles slower than v0.1.0 (5,002 generated files: 0.7 s to 2.3 s; 2,002 files: 0.6 s to 1.0 s) because it
now reads up to 5,000 files for content matching instead of 2,000 and scores more signals. Scanning is also slower: by a few milliseconds on the small
fixtures and by up to about 25% on the generated repositories (at 5,002 files it was within noise), mostly from the extra checks in the safe reader. This is a
deliberate trade of speed for coverage and safety. Scan and compile are single-threaded and synchronous.

### Determinism

Every dataset, run in two separate processes, produced byte-identical scan, context-pack and doctor output (both
versions). CI additionally compares a digest of that output between operating systems and Node.js versions
(`bench/digest.js`); that comparison has been prepared but **has not run remotely yet**.

## Honest reading of the results

- The improvement on synthetic data is real in the sense that it held on tasks that were not used for tuning. It may
  still be optimistic: the fixtures and the ranker share an author, and the fixtures are small.
- The "real" repository is one project, labelled by its author. Eight tasks cannot support a general claim.
- The Vue example now works because of general signals (rare-term weighting, distinctive-term evidence, root matching of
  "detection" and "detectors", registry awareness). No rule mentions Vue or any benchmark task. It remains one example.
- Known weak cases remain (all from ad-hoc tasks, not tuned for): "Add a loading spinner to the add to cart button" ranks
  a store module above the button component; "Write documentation for the cart module" is dominated by one document that
  happens to mention the cart; "Add a new job that notifies admins about low stock" finds `EnsureUserIsAdmin` before
  `InventoryService`. Tasks whose vocabulary does not appear in the repository ("percentage discount" for a pricing
  service) are still hard.
- Nothing here shows an effect on any AI agent.

## Frozen baseline engine

`bench/engines/v0.1.0/` is a verbatim copy of the v0.1.0 `src/`, committed so that every "before" number here can be reproduced
(`node bench/run.js --engine bench/engines/v0.1.0/src/index.js`). It contains the denial-of-service bugs fixed in v0.1.1 and must not be
used for anything else.

## Investigation of the real-repository holdout regression (R-precision 0.29 to 0.21)

Done in Phase 1.2 by comparing per-task ranks of the four held-out tasks between the two engines (data in
`results/baseline-v0.1.0.json` and `results/after-v0.1.1.json`). **Nothing was changed in response**, because the holdout is not blind
and tuning on it would defeat its purpose.

- The whole drop comes from **one task**: "Fix the output budget so the pack never exceeds the limit". `src/compiler/budget.js`
  moved from rank 3 to rank 10 (R-precision 0.33 to 0.00). The other three holdout tasks were flat or better: `test/detectors.test.js`
  22 to 9, `src/detectors/index.js` miss to 7, `test/compiler.test.js` 20 to 8, `test/scanner-safety.test.js` 16 to 8.
- **Why `budget.js` fell** (reasons recorded for every point, via `bench/explain.js --show-holdout`): the scoring is additive, and
  `src/index.js`, a barrel file that re-exports `parseBudget`, `PACK_SCHEMA_VERSION`, `exceedsThreshold` and `DEFAULT_LIMITS`, collected
  four separate symbol matches plus a "matches 4 of 6 terms" bonus and scored 23.1, against 8.0 for `budget.js`, whose single strong
  signal is its file name (5.1). Three generic task words ("output", "pack", "never") each add a little to many files, and the
  unusual word "exceeds" matched `exceedsThreshold` in an unrelated module and triggered the distinctive-term bonus.
- **Diagnosis:** the additive model lets several weak signals outweigh one strong one. Barrel/re-export files and files that touch
  many generic words are over-rewarded. These are structural properties of the scoring, so they probably affect other repositories
  too, which the independent evaluation is consistent with (it shows the same family of failures on a different codebase).
- **Candidate remedies for the next ranking iteration** (untested, to be evaluated on a new frozen set): cap symbol evidence per file,
  discount barrel files whose symbols are re-exports, weight the coverage bonus by term weight, require the distinctive-term bonus to
  come with a strong location match.
- R-precision is a cliff metric: for a three-file label set it is exactly "how many of the top three are relevant", so moving the
  best file from rank 3 to rank 10 costs the whole score although `compile.js` and the test improved.

## Files

```text
bench/
  datasets/tasks.json        tasks, labels, splits, notes
  fixtures/*.bundle          synthetic repositories ("=== path ===" followed by file content)
  snapshots/*.json           frozen real repository
  engines/v0.1.0/            frozen v0.1.0 engine used as the baseline
  external/                  frozen externally defined labels and their evaluation (see its README)
  profile.js                 cold/warm compile timing and CPU profile
  lib/                       metrics, bundle/snapshot materialisation, scale generator
  run.js  child.js           benchmark runner and the fresh-process measurement helper
  compare.js  digest.js      before/after table; cross-platform output digest
  explain.js                 per-task ranking with reasons (dev tasks)
  make-snapshot.js           how snapshots are produced
  results/                   recorded runs
```
