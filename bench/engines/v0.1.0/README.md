# Frozen v0.1.0 engine (benchmark baseline only)

A verbatim copy of `src/` and `package.json` as delivered in v0.1.0, before the Phase 1.1 changes, kept so that the
before/after comparisons in `bench/` can be reproduced:

```bash
node bench/run.js --engine bench/engines/v0.1.0/src/index.js --label "baseline"
```

**Do not use it for anything else.** It contains the denial-of-service bugs fixed in v0.1.1 (see `docs/security.md`). It is not
published, not tested, and excluded from self-analysis.
