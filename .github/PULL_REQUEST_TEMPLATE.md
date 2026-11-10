## What and why

<!-- A short description of the change and the reason for it. -->

## How it was tested

<!-- Commands you ran and what they reported, for example `node --test test/doctor.test.js` and `npm test`. -->

## Checklist

- [ ] `npm test` passes
- [ ] `npm run doctor:self` reports no problems
- [ ] If `src/` changed: `npm run skill:sync` was run and `npm run skill:check` passes
- [ ] `CHANGELOG.md` (Unreleased) and the documentation affected by the change are updated
- [ ] No real or realistic-looking secret in any file; tests assemble fakes at runtime
- [ ] No claim about token savings, cost or agent results that a measurement does not back up
- [ ] Ranking change only: `npm run bench:quick` numbers before and after are included, for `dev` and `holdout`
