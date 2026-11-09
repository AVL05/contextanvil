# First public npm beta readiness

**NO-GO for publication.** The consolidation candidate is suitable for
review and offline tarball testing. A working private security-reporting
route, publishing ownership verification, and a versioned beta artifact
still need maintainer sign-off.

## Evidence

| Area | Assessment |
| --- | --- |
| Distribution | The inspected tarball had 43 entries and occupied 82,689 bytes compressed. The allowlist covers the CLI, library, README, license, changelog, security policy and two runtime reference documents. Tests, benchmarks, frozen corpora and experiments are excluded |
| Installation | Node 22 or later, ESM library and one CLI bin. The tarball was installed offline on Windows. The installed command, public ESM import, doctor JSON and manifest create/verify were exercised. CI tests installation of the actual tarball on the platform matrix |
| npm name | On 2026-11-09 the public registry returned HTTP 404 and `npm view contextanvil` returned E404. This shows no public package was visible. It does not reserve the name, verify publishing permissions, or provide trademark clearance |
| License and attribution | The GitHub repository and package declare MIT. The tarball includes the contributor copyright and license. Frozen benchmark material and the experimental branches are outside the npm payload |
| Dependencies | Root lockfile has zero external production and development dependencies. The production npm audit reported zero advisories. That audit does not inspect first-party code or detect every vulnerability |
| Security reporting | `SECURITY.md` points to GitHub private vulnerability reporting. The repository's reporting status was verified as disabled. Enable and verify a working private route before inviting users to report issues |
| Versioning | Source remains `0.1.1` with unreleased manifest and consolidation changes. Propose `0.2.0-beta.1` and the `beta` dist-tag after approval. Finalize the changelog and update package and lockfile together in the release PR |
| CI | Stable main passed the Linux, macOS and Windows matrix with Node 22, 24 and current LTS, including the output digest and benchmark smoke test. Require the same checks plus the installed-package smoke on the exact beta candidate |

References: [stable main CI](https://github.com/AVL05/contextanvil/actions/runs/42638297218),
[npm pack](https://docs.npmjs.com/cli/v11/commands/npm-pack/) and
[npm distribution tags](https://docs.npmjs.com/adding-dist-tags-to-packages/).

## Compatibility contract for a beta

- Document Node 22+ and the tested Linux, macOS and Windows matrix.
  Filesystem-specific behavior is narrower than the OS list. Manifest create
  requires a filesystem that supports same-directory hard links.
- Keep CLI exit code meaning and the documented public ESM entry point.
  Use the `schemaVersion` fields for scan, context, doctor and manifest
  consumers. Check the schema before consuming fields and tolerate additive
  fields. Manifest command status and error envelopes are separate CLI
  responses. They do not use the on-disk manifest schema.
- Pin exact beta versions in CI. Compatibility tests cover exported names
  and representative result shapes. Determinism applies to the same
  repository bytes and configuration, with machine-local roots masked in
  the cross-platform digest.
- Share the checkout-based quickstart until a beta artifact exists.
  When published, document how to request the exact beta version explicitly.

## Residual risks

Secret matching and prompt-injection detection are heuristics. Redaction
now covers fact identifiers with detected secrets, but paths can still
contain sensitive strings and JSON can expose absolute local roots. Review
reports and manifests before sharing them. A pack is untrusted input to any
downstream agent. Read containment reduces symlink and check/use races.
Hard links and concurrent hostile filesystem changes remain outside strong
isolation guarantees. There is no wall-clock deadline for scans.

Manifests are explicit external writes. A partial snapshot cannot be
published. Full reconstruction and content hashes detect drift without
relying on timestamps. The integrity digest detects corruption and can be
recomputed by anyone. A crash can leave temporary files or a stale writer
lock. The lock coordinates ContextAnvil writers and does not provide
compare-and-swap semantics against arbitrary external writers.

## Remaining release gates

1. Establish and verify private vulnerability intake and responsible
   maintainers. Review the supported-version statement for the first beta.
2. Verify control of the npm publishing identity, recheck the name and
   agree on the beta version and dist-tag. Do not advertise registry install
   commands before the artifact exists.
3. Cut a candidate from reviewed main, finalize the changelog, inspect the
   exact tarball, run cross-platform CI, and repeat the installed-package
   smoke with doctor and manifest verification on a clean fixture.
4. Review the privacy and filesystem caveats in the packaged docs and decide
   which limitations are acceptable for a public beta.

Prioritize finding quality and first-run audit feedback during the beta.
More detectors, new retrieval signals and agent integrations can wait for
concrete use cases and evaluation evidence.
