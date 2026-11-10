import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { basename, join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

const args = process.argv.slice(2);
if (args[0] === '--sample') {
  const [, engine, repository] = args;
  const { diagnose, scanRepository } = await import(pathToFileURL(join(engine, 'src/index.js')));
  const start = performance.now();
  const report = diagnose(scanRepository(repository));
  console.log(JSON.stringify({
    milliseconds: performance.now() - start,
    maxRssKiB: process.resourceUsage().maxRSS,
    findings: report.findings.length,
  }));
} else {
  const [baseline, candidate, ...repositories] = args.map((arg) => resolve(arg));
  assert(repositories.length, 'Usage: node bench/doctor/profile.js BASELINE_ENGINE CANDIDATE_ENGINE REPOSITORY...');
  const runs = 7;
  const summary = [];
  const median = (values) => values.sort((a, b) => a - b)[Math.floor(values.length / 2)];
  for (const repository of repositories) {
    const samples = { baseline: [], candidate: [] };
    for (let index = 0; index <= runs; index++) {
      const engines = index % 2 ? [['candidate', candidate], ['baseline', baseline]] : [['baseline', baseline], ['candidate', candidate]];
      for (const [name, engine] of engines) {
        const output = execFileSync(process.execPath, [import.meta.filename, '--sample', engine, repository], {
          encoding: 'utf8', timeout: 120_000,
        });
        if (index) samples[name].push(JSON.parse(output));
      }
    }
    summary.push({
      repository: basename(repository),
      ...Object.fromEntries(Object.entries(samples).map(([name, data]) => [name, {
        medianMilliseconds: median(data.map((sample) => sample.milliseconds)),
        medianMaxRssKiB: median(data.map((sample) => sample.maxRssKiB)),
        samples: data,
      }])),
    });
  }
  console.log(JSON.stringify({ node: process.version, platform: process.platform, runs, summary }, null, 2));
}
