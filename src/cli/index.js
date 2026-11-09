import path from 'node:path';
import { parseArgs } from 'node:util';
import { parseByteSize } from '../compiler/budget.js';
import { compileContext } from '../compiler/compile.js';
import { diagnose, exceedsThreshold } from '../doctor.js';
import { ContextAnvilError, EXIT, usageError } from '../errors.js';
import { renderDoctor, renderScan, scanToJson } from '../render/text.js';
import { scanRepository } from '../scanner.js';
import { VERSION } from '../version.js';
import { HELP } from './help.js';

const LIMIT_FLAGS = {
  'max-files': { type: 'string' },
  'max-depth': { type: 'string' },
  'max-file-size': { type: 'string' },
  'no-gitignore': { type: 'boolean' },
};

const COMMANDS = {
  scan: { options: { json: { type: 'boolean' }, files: { type: 'boolean' }, ...LIMIT_FLAGS } },
  context: { options: { 'relevance-v2': { type: 'boolean' }, json: { type: 'boolean' }, budget: { type: 'string' }, top: { type: 'string' }, 'max-content-files': { type: 'string' }, ...LIMIT_FLAGS } },
  doctor: { options: { json: { type: 'boolean' }, 'fail-on': { type: 'string' }, ...LIMIT_FLAGS } },
};

function toInt(value, name) {
  if (!/^\d+$/.test(value)) throw usageError('INVALID_NUMBER', `${name} must be a positive integer, got "${value}".`);
  return Number(value);
}

function scanOptions(values) {
  const o = {};
  if (values['max-files'] !== undefined) o.maxFiles = toInt(values['max-files'], '--max-files');
  if (values['max-depth'] !== undefined) o.maxDepth = toInt(values['max-depth'], '--max-depth');
  if (values['max-file-size'] !== undefined) o.maxFileBytes = parseByteSize(values['max-file-size'], '--max-file-size');
  if (values['no-gitignore']) o.respectIgnore = false;
  return o;
}

function writeJson(io, value) {
  io.stdout.write(`${JSON.stringify(value, null, 2)}\n`);
}

/**
 * Run the CLI. Never calls process.exit, so it is directly testable and
 * stdout is always flushed.
 *
 * @param {string[]} argv Arguments after the executable name.
 * @param {{ stdout?: {write: Function}, stderr?: {write: Function}, cwd?: string }} [io]
 * @returns {Promise<number>} Exit code.
 */
export async function run(argv, io = {}) {
  const env = { stdout: io.stdout ?? process.stdout, stderr: io.stderr ?? process.stderr, cwd: io.cwd ?? process.cwd() };
  try {
    return execute(argv, env);
  } catch (err) {
    if (err instanceof ContextAnvilError) {
      env.stderr.write(`contextanvil: ${err.message}\n`);
      if (err.exitCode === EXIT.USAGE) env.stderr.write('Run "contextanvil --help" for usage.\n');
      return err.exitCode;
    }
    if (err?.code?.startsWith?.('ERR_PARSE_ARGS')) {
      env.stderr.write(`contextanvil: ${err.message}\nRun "contextanvil --help" for usage.\n`);
      return EXIT.USAGE;
    }
    env.stderr.write(`contextanvil: unexpected ${err?.name ?? 'error'}${process.env.CONTEXTANVIL_DEBUG ? `\n${err?.stack}` : ' (set CONTEXTANVIL_DEBUG=1 for details)'}\n`);
    return EXIT.RUNTIME;
  }
}

function execute(argv, env) {
  const [first, ...rest] = argv;
  if (first === undefined || first === '-h' || first === '--help' || first === 'help') {
    env.stdout.write(HELP.main);
    return first === undefined ? EXIT.USAGE : EXIT.OK;
  }
  if (first === '-v' || first === '--version') {
    env.stdout.write(`${VERSION}\n`);
    return EXIT.OK;
  }
  const spec = COMMANDS[first];
  if (!spec) throw usageError('UNKNOWN_COMMAND', `Unknown command "${first}".`);

  const { values, positionals } = parseArgs({
    args: rest,
    options: { ...spec.options, help: { type: 'boolean', short: 'h' } },
    allowPositionals: true,
    strict: true,
  });
  if (values.help) {
    env.stdout.write(HELP[first]);
    return EXIT.OK;
  }

  if (first === 'context') {
    if (positionals.length === 0 || positionals[0].trim() === '') throw usageError('MISSING_TASK', 'The context command needs a task, e.g. contextanvil context "Update the navigation component".');
    if (positionals.length > 2) throw usageError('TOO_MANY_ARGUMENTS', 'Expected at most two arguments: "<task>" [path]. Quote the task text.');
  } else if (positionals.length > 1) {
    throw usageError('TOO_MANY_ARGUMENTS', `Expected at most one path argument, got ${positionals.length}.`);
  }
  const task = first === 'context' ? positionals[0] : null;
  const target = path.resolve(env.cwd, (first === 'context' ? positionals[1] : positionals[0]) ?? '.');

  if (first === 'doctor' && values['fail-on'] !== undefined && !['error', 'warning', 'never'].includes(values['fail-on'])) {
    throw usageError('INVALID_FAIL_ON', '--fail-on must be one of: error, warning, never.');
  }
  const scan = scanRepository(target, scanOptions(values));

  if (first === 'scan') {
    if (values.json) writeJson(env, scanToJson(scan, { includeFiles: values.files }));
    else env.stdout.write(renderScan(scan));
    return EXIT.OK;
  }
  if (first === 'context') {
    const top = values.top === undefined ? undefined : toInt(values.top, '--top');
    const maxContentFiles = values['max-content-files'] === undefined ? undefined : toInt(values['max-content-files'], '--max-content-files');
    const pack = compileContext(scan, task, { budget: values.budget, top, maxContentFiles, relevanceV2: values['relevance-v2'], retrievalDiagnostics: values['relevance-v2'] && values.json });
    if (values.json) writeJson(env, pack);
    else env.stdout.write(pack.rendered);
    return EXIT.OK;
  }
  const report = diagnose(scan);
  if (values.json) writeJson(env, report);
  else env.stdout.write(renderDoctor(report));
  return exceedsThreshold(report, values['fail-on'] ?? 'warning') ? EXIT.FINDINGS : EXIT.OK;
}
