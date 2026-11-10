#!/usr/bin/env node
// Launcher for the ContextAnvil Skill. Runs the vendored, read-only analysis
// engine from wherever the Skill was installed. No install step, no network,
// no dependencies. Only the read-only commands are exposed here.
const ALLOWED = new Set(['scan', 'doctor', 'context', '--help', '-h', 'help', '--version', '-v']);
const [major] = process.versions.node.split('.').map(Number);

if (major < 22) {
  process.stderr.write(`contextanvil: Node.js 22 or later is required (found ${process.versions.node}).\n`);
  process.exit(3);
}

const args = process.argv.slice(2);
if (args[0] === 'manifest') {
  process.stderr.write('contextanvil: "manifest" writes files and is not exposed by the Skill launcher. Use the full CLI from the ContextAnvil repository if you need it.\n');
  process.exit(2);
}
if (args.length && !ALLOWED.has(args[0])) {
  process.stderr.write(`contextanvil: unknown command "${args[0]}". Use scan, doctor or context.\n`);
  process.exit(2);
}

const { run } = await import(new URL('../src/cli/index.js', import.meta.url).href);
process.exitCode = await run(args);
