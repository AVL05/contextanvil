import assert from 'node:assert/strict';
import { execFileSync, spawn } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const [clones, output, claude, onlyTask] = process.argv.slice(2);
assert.ok(clones && output && claude, 'Usage: node bench/mcp-discovery/run.js <clones> <new-output-directory> <claude-executable>');
const base = path.resolve(output);
fs.mkdirSync(base);
const tasks = JSON.parse(fs.readFileSync(new URL('./cases.json', import.meta.url)));
const server = fileURLToPath(new URL('../../mcp/server.js', import.meta.url));
const arms = [['A', 'B', 'C'], ['C', 'B', 'A']];
const selected = tasks.filter((task) => !onlyTask || task.id === onlyTask);
assert.ok(selected.length, 'Unknown task');

async function run(task, arm) {
  const key = task.id + '-' + arm;
  const cwd = path.join(base, key);
  const config = path.join(base, key + '.config.json');
  const mcpServers = arm === 'A' ? {} : {
    contextanvil: { command: process.execPath, args: [server, '--repo', 'app=' + cwd] },
  };
  fs.writeFileSync(config, JSON.stringify({ mcpServers }), { flag: 'wx' });
  const prompt = arm === 'C'
    ? 'Before exploring the repository, consult ContextAnvil get_task_context once using repository alias app and the task below. Then continue normally.\n\n' + task.prompt
    : task.prompt;
  const stdout = fs.openSync(path.join(base, key + '.jsonl'), 'wx');
  const stderr = fs.openSync(path.join(base, key + '.stderr'), 'wx');
  const startedAt = Date.now();
  const start = performance.now();
  try {
    const child = spawn(claude, [
      '-p', '--verbose', '--output-format', 'stream-json', '--model', 'claude-sonnet-5-5', '--effort', 'low',
      '--no-session-persistence', '--strict-mcp-config', '--setting-sources', '',
      '--permission-mode', 'acceptEdits', '--tools', 'Read,Edit,Glob,Grep',
      '--allowedTools', 'mcp__contextanvil__*', '--mcp-config', config, '--', prompt,
    ], { cwd, stdio: ['ignore', stdout, stderr] });
    const timer = setTimeout(() => child.kill(), 180000);
    try {
      const status = await new Promise((resolve, reject) => {
        child.once('error', reject);
        child.once('close', (code, signal) => resolve({ code, signal }));
      });
      const observation = { key, ...status, startedAt, elapsedMs: Math.round(performance.now() - start) };
      fs.writeFileSync(path.join(base, key + '.timing.json'), JSON.stringify(observation), { flag: 'wx' });
      console.log(JSON.stringify(observation));
    } finally {
      clearTimeout(timer);
    }
  } finally {
    fs.closeSync(stdout);
    fs.closeSync(stderr);
  }
}

for (const task of selected) {
  // Use an isolated index so export-ignore cannot remove tracked tests or docs.
  const original = path.join(base, task.id + '-original');
  const index = path.join(base, task.id + '.index');
  const env = { ...process.env, GIT_INDEX_FILE: index };
  const git = (args) => execFileSync('git', ['-C', path.join(clones, task.clone), '-c', 'core.autocrlf=false', ...args], { env });
  fs.mkdirSync(original);
  git(['read-tree', task.parent]);
  git(['checkout-index', '--all', '--prefix=' + original.split(path.sep).join('/') + '/']);
  fs.unlinkSync(index);
  assert.ok(task.essential.every((file) => fs.statSync(path.join(original, file)).isFile()));
  for (const arm of ['A', 'B', 'C']) {
    fs.cpSync(original, path.join(base, task.id + '-' + arm), { recursive: true, force: false, errorOnExist: true });
  }
}

await Promise.all(selected.map(async (task) => {
  for (const arm of arms[tasks.indexOf(task)]) await run(task, arm);
}));
