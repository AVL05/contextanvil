# External evaluation: results and analysis

Run once, on the frozen labels (sha256 `a8205f3b...ce69af`), with the Phase 1.1 engine (commit `8ea9cbd`, v0.1.1) and the
frozen v0.1.0 engine (`bench/engines/v0.1.0`). The raw per-task data is `results/run-1.json`, the table
`results/run-1.md`, the paired bootstrap `results/run-1-bootstrap.md`.
**No ranking change was made after seeing these results.** Later commits in this phase changed output formatting and
a system call (see `docs/performance.md`) and were checked to leave every ranking in the author-labelled benchmark
identical; they were not tuned against this set. This evaluation set is now spent for tuning purposes: any further
ranking work must be evaluated on a new, newly frozen label set.

## Result

33 tasks have at least one rankable label (3 of the 36 changed only files that no text ranking can return). Macro-average
over those tasks, rankable labels:

| Engine | P@1 | MRR | R-precision | Recall@5 | Recall@8 | Default-pack recall | Default pack size |
| ------ | --- | --- | ----------- | -------- | -------- | ------------------- | ----------------- |
| v0.1.0 | 0.24 | 0.36 | 0.17 | 0.26 | 0.33 | 0.32 | 9,050 B |
| v0.1.1 | 0.33 | 0.43 | 0.21 | 0.28 | 0.44 | 0.43 | 9,295 B |

Counting every changed file (including CSS, dotfiles and extension-less files that no text ranking can return), over all 36
tasks: v0.1.1 P@1 0.31, MRR 0.40, R-precision 0.19, Recall@5 0.23.

Paired bootstrap, v0.1.1 minus v0.1.0 (95% interval over resampled tasks):

| Metric | Difference | 95% interval | Distinguishable from 0 |
| ------ | ---------- | ------------ | ---------------------- |
| P@1 | +0.09 | [-0.03, +0.21] | no |
| MRR | +0.07 | [-0.01, +0.15] | no |
| R-precision | +0.05 | [-0.01, +0.12] | no |
| Recall@5 | +0.02 | [-0.07, +0.11] | no |
| Recall@8 | +0.12 | [+0.03, +0.23] | yes |

Per repository (v0.1.1, rankable labels): `portfolio` (12 tasks) P@1 0.50, MRR 0.61, R-precision 0.34; `alexgallery` (12)
P@1 0.25, MRR 0.34, R-precision 0.10, Recall@5 0.09 (**lower** than v0.1.0's 0.15); `lumaflow-studio` (7) P@1 0.00, MRR 0.12;
`premium-frontend-showcase` (2) too small to read anything from.

## What this says

1. **The author-labelled benchmark was optimistic.** On it, v0.1.1 reaches MRR 0.92 on synthetic and 0.79 on the
   frozen real repository. On independently defined labels from real work it reaches 0.43. Treat 0.43, not 0.92, as the best
   current estimate of how the ranker behaves on repositories it was not built around, with the caveats below.
2. **The improvement over v0.1.0 is real in direction and small in size.** Every headline metric moved the right way, but only
   Recall@8 is distinguishable from noise on 33 tasks.
3. **The dominant failure is zero lexical overlap, not mis-ordering.** 44 of the 105 rankable labels (42%) are not returned at
   all, because the commit subject shares no word with the file's name, path, symbols or content ("unify motion system",
   "harden production experience", "simplify access screens" where the files are called `AuthShell`, `LoginPage`). A better
   scoring formula cannot fix that. It needs either richer task text, synonyms, or signals other than words (for example
   co-change history, which ContextAnvil deliberately does not use yet).
4. **Subjects are terse and labels are broad.** Several commits change many files for one vague subject. A ranker that is
   good at "which file does this sentence point at" will score poorly on them by construction. This is realistic and a
   limitation of the method.
5. **Docs-only and config-only tasks work poorly** (`record production deployment`, `consolidate repository instructions`):
   the right file is a long report or instruction document that does not use the subject's words.

## Caveats

- The repositories belong to the author of the ranker, and three of the four share a stack. Labels are from commit history, not
  from the author's judgement, but the sample is not representative of software in general.
- 33 tasks. Per-repository numbers rest on 2 to 12 tasks.
- A commit's file list is "what changed", not "what was worth reading".
- Timings in `run-1.md` are **not comparable between engines**: each task's tree was freshly extracted, v0.1.0 always ran
  first on it and paid the cold-cache cost. Use `docs/performance.md` for timing.
