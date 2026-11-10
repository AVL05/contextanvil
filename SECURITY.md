# Security Policy

ContextAnvil reads repositories you may not trust and produces text that AI agents consume, so we treat
security reports seriously.

## Reporting a vulnerability

Please **do not open a public issue** for a vulnerability.

Use GitHub's private vulnerability reporting on the project repository (Security tab, "Report a
vulnerability"). If that option is not shown, open a public issue that says only that you have a security report and
asks for a private channel; do not put any details, proof of concept or secrets in it.

Include: the ContextAnvil version (`contextanvil --version`), your Node.js version and OS, a minimal
repository or file set that reproduces the problem, and the impact you believe it has. Do not include real
secrets in a report.

Best-effort expectations: acknowledgement within a week, a fix or mitigation plan after triage, and credit in
the changelog if you want it. This is a volunteer-run open-source project and carries no SLA.

## Supported versions

Only the latest released version receives security fixes while the project is on 0.x.

## In scope

- Reading, writing, executing or transmitting anything outside what `docs/security.md` guarantees: for
  example following a symlink out of the scanned root, reading a sensitive file, executing repository code,
  modifying a scanned directory, or making a network request.
- Secrets or sensitive file contents appearing in `scan`, `context` or `doctor` output.
- Repository text altering ContextAnvil's behaviour (treated as instructions rather than data).
- Denial of service through crafted repositories that bypass the configured limits (unbounded memory, CPU or
  recursion), including regular-expression backtracking on crafted text, file names or ignore patterns (two such
  issues were found and fixed in 0.1.1; see `docs/security.md`).
- Terminal escape sequences or invisible characters from repository text reaching output unescaped.

## Out of scope

- Behaviour of AI agents or providers that receive generated context, including an agent that ignores the Skill's
  instruction not to open secret-flagged lines (a documented residual risk).
- Secrets that ContextAnvil is documented not to detect (see "Known limitations" in `docs/security.md`),
  unless a documented pattern fails to match.
- Vulnerabilities in scanned repositories themselves.

## Security design

See `docs/security.md` for the guarantees, how they are enforced, and known limitations.
