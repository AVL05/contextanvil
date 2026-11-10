# Contributing to ContextAnvil

Thanks for helping forge better context. This project values correctness, evidence and safety over feature
count. Please read `AGENTS.md` (the rules apply to humans too) and `docs/architecture.md` first.

## Setup

Requires Node.js 22 or later and npm. There are no runtime dependencies.

```bash
git clone <your fork>
cd contextanvil
npm test
node bin/contextanvil.js scan .
```

## Workflow

1. Open an issue for anything non-trivial so the approach can be agreed before you invest time.
2. Create a branch, make a focused change, and add or update tests.
3. Run the targeted test file while iterating (`node --test test/compiler.test.js`) and the full `npm test` before
   you open a pull request.
4. Run `npm run doctor:self`; the repository must keep a clean `doctor` result.
5. If you changed anything under `src/`, run `npm run skill:sync` and commit the regenerated `skills/contextanvil/src/`;
   `npm run skill:check`, `npm test` and CI fail when the Skill's copy of the engine differs.
6. Update `CHANGELOG.md` (under "Unreleased") and any documentation that your change affects.

## What a good change looks like

- **Evidence first.** A new fact needs a source file and, where possible, a line. If it is a heuristic, mark it
  `inferred` and store the counts it came from. Do not claim more than the evidence supports.
- **Deterministic.** No timestamps, randomness or locale-dependent sorting in output.
- **Safe.** No execution of scanned code, no writes to scanned directories, no network, no reading outside the
  reader. Anything that reaches output from a scanned file goes through `redact()` and the neutraliser (facts do this for you).
  Regular expressions over repository text must be bounded and come with an adversarial test.
- **Tested.** Prefer small temporary repositories built with `makeRepo()` over new static fixtures. Never commit
  realistic secrets; build fakes at runtime as `test/helpers.js` does.
- **Minimal.** New dependencies need a strong written justification. Avoid abstractions without a second user.

## Changing relevance ranking

1. Run `npm run bench:quick` before and after. Report the aggregate numbers for both the `dev` and `holdout` splits and the
   synthetic and real sets, including anything that got worse.
2. Tune on `dev` tasks only (`node bench/explain.js <dataset> <task>` shows why files ranked as they did). Look at holdout
   aggregates, not per-task holdout results.
3. No special cases for particular words, frameworks or benchmark tasks. A signal must be general, explainable and recorded
   as a reason on every point it adds.
4. Add a regression test in `test/relevance.test.js` using a task that was not used for tuning.
5. New benchmark tasks are welcome, especially labels by someone other than the code's author; label them before
   running the ranker.

## Changing the Skill

The Skill lives in `skills/contextanvil/`: edit `SKILL.md`, `references/` and `scripts/contextanvil.mjs` directly, but never the
copy of the engine in `skills/contextanvil/src/` (it is generated from `src/`). Keep `SKILL.md` short, keep the rule that agents
must not open secret-flagged lines, and make no claim that the Skill saves tokens or improves results: nothing measures that.
Behaviour that the agents depend on is covered by `test/skill.test.js`; background and test results are in
[docs/skill.md](docs/skill.md).

## Adding a detector

1. Create `src/detectors/<name>.js` exporting `id` and `detect(ctx)`.
2. Emit facts with `ctx.addFact({ kind, id, claim, status, confidence, evidence, data })`.
3. Register it in `src/detectors/index.js` (order matters if you read `ctx.shared`).
4. Add tests in `test/detectors.test.js` covering the positive case, the absent case and malformed input.

## Commit and PR style

Short imperative subject lines ("Add Vue detector"), a body explaining why, and a PR description that lists what
you tested. Be kind in reviews.

## Reporting bugs

Include `contextanvil --version`, your OS and Node.js version, the command, and the smallest repository
structure that reproduces the problem. For security issues, follow `SECURITY.md` instead.

## Licence

By contributing you agree that your contributions are licensed under the MIT licence of this project.
