# Security Policy

ContextAnvil reads repositories you may not trust and produces text that AI agents consume, so we treat
security reports seriously.

## Reporting a vulnerability

Please **do not open a public issue** for a vulnerability.

The intended channel is GitHub Private Vulnerability Reporting in the
[repository Security tab](https://github.com/AVL05/contextanvil/security).
The setting was verified disabled on 2026-11-09. While the private reporting
button is unavailable, keep the details private. No alternative private
contact is listed.

Include: the ContextAnvil version (`contextanvil --version`), your Node.js version and OS, a minimal
repository or file set that reproduces the problem, and the impact you believe it has. Do not include real
secrets in a report.

Best-effort expectations: acknowledgement within a week, a fix or mitigation plan after triage, and credit in
the changelog if you want it. This is a volunteer-run open-source project and carries no SLA.

## Supported versions

`0.2.0-beta.1` is an unpublished candidate. Once a beta is released,
maintainers intend to provide best-effort security fixes for the latest
published 0.x version. Earlier previews and experimental branches are
outside that support policy.

## Maintainer responsibilities

Before approving the first public beta, enable the private reporting
channel, verify access to the advisory inbox, and identify who will
triage reports. Keep vulnerability details private during triage, coordinate
disclosure with reporters, and publish remediation and affected-version
information through a security advisory when appropriate.

## In scope

- Reading, writing, executing or transmitting anything outside what `docs/security.md` guarantees: for
  example following a symlink out of the scanned root, reading a sensitive file, executing repository code,
  modifying a scanned directory, or making a network request.
- Exposure of secrets covered by documented redaction rules or content from
  sensitive files in reports or manifests.
- Repository text altering ContextAnvil's behaviour (treated as instructions rather than data).
- Denial of service through crafted repositories that bypass the configured limits (unbounded memory, CPU or
  recursion), including regular-expression backtracking on crafted text, file names or ignore patterns (two such
  issues were found and fixed in 0.1.1; see `docs/security.md`).
- Terminal escape sequences or invisible characters from repository text reaching output unescaped.

## Out of scope

- Behaviour of AI agents or providers that receive generated context.
- Secrets that ContextAnvil is documented not to detect (see "Known limitations" in `docs/security.md`),
  unless a documented pattern fails to match.
- Vulnerabilities in scanned repositories themselves.

## Security design

Secret detection and instruction diagnostics are heuristic. Output can
contain local paths or sensitive context. Filesystem containment reduces
symlink races, but concurrent changes and hard links limit isolation.
Manifest hashes detect accidental changes and can be recomputed by an
attacker. See [security design](docs/security.md) for details.
