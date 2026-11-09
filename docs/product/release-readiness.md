# First public npm beta readiness

**NO-GO for merging PR #9 or publishing the beta.** The versioned candidate
is `contextanvil@0.2.0-beta.1`, MIT, for Node.js 22+. A working private
security-reporting route and an authorized npm publisher still need
verification. The intended registry tag is `beta`.

## Evidence

| Area | Assessment |
| --- | --- |
| Distribution | The inspected tarball had 43 entries and occupied 83,357 bytes compressed. The [inventory](rc-package-inventory.json) records its SHA-256 and paths. Tests, benchmarks, frozen corpora and experiments are excluded |
| Installation | The exact local tarball was installed offline on Windows. The npm CLI shim, version and help, scan, doctor, context, full manifest lifecycle, representative errors and public ESM exports passed. CI builds a canonical Ubuntu tarball and verifies its SHA-256 before installing it in each matrix job |
| npm name | On 2026-11-09 the public registry returned HTTP 404 and `npm view contextanvil` returned E404. This shows no public package was visible. It does not reserve the name, verify publishing permissions, or provide trademark clearance |
| License and attribution | The GitHub repository and package declare MIT. The tarball includes the contributor copyright and license. Frozen benchmark material and the experimental branches are outside the npm payload |
| Dependencies | Root lockfile has zero external production and development dependencies. The production npm audit reported zero advisories. That audit does not inspect first-party code or detect every vulnerability |
| Security reporting | GitHub's private vulnerability reporting endpoint returned `enabled: false` on 2026-11-09. The [security policy](../../SECURITY.md) records the status and the maintainer gate |
| npm identity | `npm whoami` against the public registry returned `ENEEDAUTH`. Account ownership, 2FA, token scope and permission to publish the name could not be verified. No trusted publisher is configured by this repository's CI |
| Versioning | Package metadata and lockfile agree on `0.2.0-beta.1`. The changelog describes the unpublished candidate. `publishConfig` selects the public npm registry, public access and the `beta` tag |
| CI | Linux, macOS and Windows run Node 22, 24 and current LTS. The installed-package smoke extends the existing tests, determinism digest and benchmark smoke without replacing them |

References: [stable main CI](https://github.com/AVL05/contextanvil/actions/runs/42638297218),
[npm pack](https://docs.npmjs.com/cli/v11/commands/npm-pack/) and
[npm distribution tags](https://docs.npmjs.com/adding-dist-tags-to-packages/).

## Artifact and publisher checks

The local artifact was built with Node 24.22.2 and npm 11.19.1 using
`npm pack --ignore-scripts` and installed from a temporary directory
without registry access. A second pack inspection matched its recorded
SHA-1. The inventory records the stronger SHA-256 for transfer verification.
The installed npm shim is the supported executable entry point. The package
exports the ESM API and package metadata. Inspection found no lifecycle
scripts, private workstation paths, or runtime network or child-process
imports. The secret-pattern scan flagged two historical example credential
URLs in documentation, both placeholders. This was a scoped artifact review,
not a comprehensive secret audit.

An approved publisher must use a method permitted by npm. For an interactive
first release, verify the account and its 2FA before approval. Noninteractive
publication requires separately configured credentials or trusted publishing
with appropriate permission. The package settings specify the intended
destination and tag and do not confer permission. See
[npm publishing authentication requirements](https://docs.npmjs.com/requiring-2fa-for-package-publishing-and-settings-modification/)
and [trusted publishing](https://docs.npmjs.com/trusted-publishers/).

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
2. Authenticate the intended npm maintainer and verify publishing authority
   and 2FA or another approved authentication method. Recheck registry
   visibility immediately before an authorized publish.
3. Review the exact candidate and CI artifact, then explicitly approve the
   merge and publication separately. If packaged bytes change after the
   reporting policy is updated, rebuild, inspect and rerun the candidate checks.

Prioritize finding quality and first-run audit feedback during the beta.
More detectors, new retrieval signals and agent integrations can wait for
concrete use cases and evaluation evidence.
