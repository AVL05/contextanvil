#!/usr/bin/env node
// Launcher for the ContextAnvil Skill. Runs the vendored, read-only analysis
// engine from wherever the Skill was installed. No install step, no network,
// no dependencies. Only the read-only commands are exposed here.
import { readFileSync } from 'node:fs';

const ALLOWED =new Set(['scan', 'doctor', 'context', '--help', '-h', 'help', '--version', '-v']);
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

// The engine's .js files are ES modules only because of the package.json next to this Skill's src/.
// Without it Node.js would consult the host project's package.json, so fail clearly instead.
try {
  if (JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8')).type !== 'module') throw new Error('not a module');
} catch {
  process.stderr.write('contextanvil: the Skill is incomplete (package.json with "type": "module" is missing next to src/). Reinstall the whole skills/contextanvil directory.\n');
  process.exit(3);
}

const { run } = await import(new URL('../src/cli/index.js', import.meta.url).href);
process.exitCode = await run(args);
