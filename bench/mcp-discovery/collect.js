import fs from 'node:fs';
import path from 'node:path';

const base = path.resolve(process.argv[2]);
const tasks = JSON.parse(fs.readFileSync(new URL('./cases.json', import.meta.url)));
const names = ['A', 'B', 'C'];
const onlyTask = process.argv[3];
const traceChanges = process.argv[4] === '--trace-changes';

function paths(root) {
  return fs.readdirSync(root, { recursive: true, withFileTypes: true }).filter((item) => item.isFile())
    .map((item) => path.relative(root, path.join(item.parentPath, item.name)).split(path.sep).join('/')).sort();
}

function observe(task, arm) {
  const key = task.id + '-' + arm;
  const root = path.join(base, key);
  const original = path.join(base, task.id + '-original');
  const timingFile = path.join(base, key + '.timing.json');
  const timing = JSON.parse(fs.readFileSync(timingFile));
  const sessionStart = timing.startedAt ?? fs.statSync(timingFile).mtimeMs - timing.elapsedMs;
  const log = fs.readFileSync(path.join(base, key + '.jsonl'), 'utf8').split('\n').filter(Boolean).map(JSON.parse);
  const known = new Set(paths(original));
  const present = new Set(paths(root));
  const init = log.find((row) => row.subtype === 'init');
  const result = log.find((row) => row.type === 'result');
  const discovered = new Set();
  const mcpPaths = new Set();
  const edited = new Set();
  const tools = new Map();
  const sequence = [];
  const errors = [];
  let first = null;
  let firstSource = null;
  let mcpBytes = 0;
  const record = (file, source, timestamp) => {
    if (typeof file !== 'string') return;
    const relative = path.relative(root, path.resolve(root, file)).split(path.sep).join('/');
    if (!known.has(relative)) return;
    discovered.add(relative);
    if (source === 'mcp') mcpPaths.add(relative);
    if (source === 'edit') edited.add(relative);
    if (firstSource === null && task.essential.includes(relative)) {
      firstSource = source;
      const now = Date.parse(timestamp);
      if (Number.isFinite(now)) first = Math.max(0, Math.round(now - sessionStart));
    }
  };
  for (const row of log) {
    for (const item of row.message?.content ?? []) {
      if (item.type === 'tool_use' && !tools.has(item.id)) {
        tools.set(item.id, item.name);
        sequence.push(item.name);
      }
      if (item.type !== 'tool_result') continue;
      const name = tools.get(item.tool_use_id);
      if (item.is_error) errors.push(name ?? 'unknown');
      if (name?.startsWith('mcp__contextanvil__')) {
        const parts = typeof item.content === 'string' ? [{ text: item.content }] : item.content ?? [];
        for (const part of parts) {
          if (typeof part.text !== 'string') continue;
          mcpBytes += Buffer.byteLength(part.text);
          try {
            for (const entry of JSON.parse(part.text).items ?? []) {
              if (entry.type === 'file') record(entry.path, 'mcp', row.timestamp);
            }
          } catch { /* Tool errors can contain plain text. */ }
        }
      }
    }
    if (row.type !== 'user') continue;
    const output = row.tool_use_result;
    record(output?.file?.filePath, 'read', row.timestamp);
    record(output?.filePath, 'edit', row.timestamp);
    for (const file of output?.filenames ?? []) record(file, 'search', row.timestamp);
    for (const line of typeof output?.content === 'string' ? output.content.split('\n') : []) {
      const candidate = /^([^:]+):[0-9]+:/.exec(line);
      if (candidate) record(candidate[1], 'search', row.timestamp);
    }
  }
  const usage = result?.usage;
  const changed = [...new Set([...known, ...present])].sort().filter((file) => {
    if (!known.has(file) || !present.has(file)) return true;
    const before = path.join(original, file);
    const after = path.join(root, file);
    if (traceChanges && !edited.has(file)) {
      const stat = fs.statSync(after);
      if (stat.size === fs.statSync(before).size && stat.mtimeMs < sessionStart) return false;
    }
    return !fs.readFileSync(before).equals(fs.readFileSync(after));
  });
  return {
    task: task.id, arm, model: init?.model ?? null,
    connected: init?.mcp_servers?.some((server) => server.name === 'contextanvil' && server.status === 'connected') ?? false,
    advertisedMcpTools: (init?.tools ?? []).filter((tool) => typeof tool === 'string' && tool.startsWith('mcp__contextanvil__')),
    exitCode: timing.code, sessionError: result?.is_error ?? null,
    elapsedMs: timing.elapsedMs, firstEssentialMs: first, firstEssentialSource: firstSource,
    discovered: [...discovered].sort(),
    essentialDiscovered: task.essential.filter((file) => discovered.has(file)),
    relevantDiscovered: [...task.essential, ...task.incidental].filter((file) => discovered.has(file)),
    changed, toolSequence: sequence, toolCalls: sequence.length,
    exploratoryCalls: sequence.filter((tool) => ['Glob', 'Grep'].includes(tool)).length,
    reads: sequence.filter((tool) => tool === 'Read').length,
    mcpCalls: sequence.filter((tool) => tool.startsWith('mcp__contextanvil__')).length,
    mcpBytes, mcpPaths: [...mcpPaths].sort(), toolErrors: errors,
    usage: usage ? Object.fromEntries(['input_tokens', 'cache_creation_input_tokens', 'cache_read_input_tokens', 'output_tokens']
      .map((key) => [key, usage[key] ?? null])) : null,
  };
}

console.log(JSON.stringify(tasks.filter((task) => !onlyTask || task.id === onlyTask)
  .flatMap((task) => names.map((arm) => observe(task, arm))), null, 2));
