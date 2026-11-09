# Before / after: baseline: v0.1.0 as delivered (before Phase 1.1) -> after: Phase 1.1 (v0.1.1)

Before: engine v0.1.0. After: engine v0.1.1. Node v24.22.2 on win32-x64.
Same datasets, same labels, same harness; only the engine differs.

## Ranking quality (macro-average over tasks)

| Set | Tasks | Metric | Before | After | Change |
|---|---|---|---|---|---|
| synthetic / dev | 13 | P@1 | 0.69 | 0.92 | +0.23 |
| synthetic / dev | 13 | P@3 | 0.51 | 0.56 | +0.05 |
| synthetic / dev | 13 | R@3 | 0.69 | 0.72 | +0.03 |
| synthetic / dev | 13 | R@5 | 0.79 | 0.86 | +0.07 |
| synthetic / dev | 13 | R@8 | 0.85 | 0.90 | +0.06 |
| synthetic / dev | 13 | MRR | 0.83 | 0.96 | +0.13 |
| synthetic / dev | 13 | R-precision | 0.61 | 0.72 | +0.11 |
| synthetic / dev | 13 | packRecall | 0.85 | 0.90 | +0.06 |
| synthetic / holdout | 13 | P@1 | 0.61 | 0.77 | +0.15 |
| synthetic / holdout | 13 | P@3 | 0.46 | 0.54 | +0.08 |
| synthetic / holdout | 13 | R@3 | 0.63 | 0.73 | +0.10 |
| synthetic / holdout | 13 | R@5 | 0.77 | 0.86 | +0.09 |
| synthetic / holdout | 13 | R@8 | 0.86 | 0.89 | +0.03 |
| synthetic / holdout | 13 | MRR | 0.75 | 0.87 | +0.12 |
| synthetic / holdout | 13 | R-precision | 0.51 | 0.69 | +0.18 |
| synthetic / holdout | 13 | packRecall | 0.86 | 0.89 | +0.03 |
| synthetic / all | 26 | P@1 | 0.65 | 0.85 | +0.19 |
| synthetic / all | 26 | P@3 | 0.49 | 0.55 | +0.06 |
| synthetic / all | 26 | R@3 | 0.66 | 0.72 | +0.07 |
| synthetic / all | 26 | R@5 | 0.78 | 0.86 | +0.08 |
| synthetic / all | 26 | R@8 | 0.85 | 0.89 | +0.04 |
| synthetic / all | 26 | MRR | 0.79 | 0.92 | +0.12 |
| synthetic / all | 26 | R-precision | 0.56 | 0.70 | +0.14 |
| synthetic / all | 26 | packRecall | 0.85 | 0.89 | +0.04 |
| real / dev | 4 | P@1 | 0.25 | 1.00 | +0.75 |
| real / dev | 4 | P@3 | 0.42 | 0.58 | +0.17 |
| real / dev | 4 | R@3 | 0.50 | 0.75 | +0.25 |
| real / dev | 4 | R@5 | 0.63 | 0.88 | +0.25 |
| real / dev | 4 | R@8 | 0.75 | 1.00 | +0.25 |
| real / dev | 4 | MRR | 0.56 | 1.00 | +0.44 |
| real / dev | 4 | R-precision | 0.50 | 0.63 | +0.13 |
| real / dev | 4 | packRecall | 0.75 | 1.00 | +0.25 |
| real / holdout | 4 | P@1 | 0.25 | 0.50 | +0.25 |
| real / holdout | 4 | P@3 | 0.25 | 0.25 | +0.00 |
| real / holdout | 4 | R@3 | 0.29 | 0.33 | +0.04 |
| real / holdout | 4 | R@5 | 0.38 | 0.42 | +0.04 |
| real / holdout | 4 | R@8 | 0.67 | 0.75 | +0.08 |
| real / holdout | 4 | MRR | 0.50 | 0.59 | +0.09 |
| real / holdout | 4 | R-precision | 0.29 | 0.21 | -0.08 |
| real / holdout | 4 | packRecall | 0.67 | 0.75 | +0.08 |
| real / all | 8 | P@1 | 0.25 | 0.75 | +0.50 |
| real / all | 8 | P@3 | 0.33 | 0.42 | +0.08 |
| real / all | 8 | R@3 | 0.40 | 0.54 | +0.15 |
| real / all | 8 | R@5 | 0.50 | 0.65 | +0.15 |
| real / all | 8 | R@8 | 0.71 | 0.88 | +0.17 |
| real / all | 8 | MRR | 0.53 | 0.79 | +0.26 |
| real / all | 8 | R-precision | 0.40 | 0.42 | +0.02 |
| real / all | 8 | packRecall | 0.71 | 0.88 | +0.17 |

Pack recall = share of relevant files present in the default-budget (3000 estimated tokens) pack.

## Per dataset (all tasks)

| Dataset | Metric | Before | After | Change |
|---|---|---|---|---|
| shop-next | MRR | 0.81 | 0.95 | +0.14 |
| shop-next | R-precision | 0.48 | 0.62 | +0.13 |
| shop-next | R@3 | 0.58 | 0.62 | +0.03 |
| orders-laravel | MRR | 0.63 | 0.85 | +0.23 |
| orders-laravel | R-precision | 0.45 | 0.65 | +0.20 |
| orders-laravel | R@3 | 0.57 | 0.65 | +0.07 |
| plugin-cli | MRR | 0.94 | 0.94 | +0.00 |
| plugin-cli | R-precision | 0.77 | 0.88 | +0.10 |
| plugin-cli | R@3 | 0.83 | 0.94 | +0.10 |
| contextanvil-0.1.0 | MRR | 0.53 | 0.79 | +0.26 |
| contextanvil-0.1.0 | R-precision | 0.40 | 0.42 | +0.02 |
| contextanvil-0.1.0 | R@3 | 0.40 | 0.54 | +0.15 |

## Tasks that got better or worse (R-precision, all splits; task text shown only for dev)

Across 34 tasks: 10 improved, 2 regressed, 22 unchanged (R-precision).

## Performance (same machine, medians; single-machine numbers are indicative only)

| Dataset | Files | Scan ms before | Scan ms after | Compile ms before | Compile ms after | Cold peak RSS MB before | after |
|---|---|---|---|---|---|---|---|
| shop-next | 43 | 11.9 | 15.6 | 10.6 | 16 | 49 | 50 |
| orders-laravel | 37 | 11.9 | 20.2 | 7.8 | 15.2 | 48.4 | 49.4 |
| plugin-cli | 31 | 6.4 | 9.3 | 6.4 | 10.4 | 47.7 | 49.5 |
| contextanvil-0.1.0 | 57 | 8.9 | 11.2 | 16.5 | 23.1 | 51.7 | 50.9 |

### Synthetic scale (generated repositories; median of 3 fresh processes after a warm-up)

| Files | Scan ms before | after | Compile ms before | after | Peak RSS MB before | after |
|---|---|---|---|---|---|---|
| 502 | 35 | 43 | 175 | 251 | 51 | 56 |
| 2002 | 62 | 78 | 588 | 1043 | 64 | 73 |
| 5002 | 127 | 119 | 696 | 2313 | 70 | 98 |

### Local real repositories (private, anonymised; timing only)

| Repo | Files | Scan ms before | after | Compile ms before | after | Peak RSS MB before | after |
|---|---|---|---|---|---|---|---|
| local-1 | 357 | 45 | 50 | 91 | 110 | 67 | 66 |
| local-2 | 695 | 78 | 88 | 193 | 267 | 72 | 72 |

## Determinism

Two separate processes produced byte-identical scan, pack and doctor output for every dataset: before yes, after yes.
