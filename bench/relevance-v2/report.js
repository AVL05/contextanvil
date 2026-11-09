import fs from 'node:fs';
import { median } from '../lib/metrics.js';

const [devFile, postMortemFile, scaleFile] = process.argv.slice(2);
const read = (file) => JSON.parse(fs.readFileSync(file, 'utf8'));
const dev = read(devFile);
const postMortem = read(postMortemFile);
const fixed = (n, digits = 3) => n.toFixed(digits);

console.log('# Relevance v2 regression investigation\n');
console.log(`## Development ablations (${dev.rows.length} tasks)\n`);
console.log('| Variant | Candidate R@64 | P@1 | MRR | R-precision | 8 KiB coverage | Bytes |');
console.log('| --- | ---: | ---: | ---: | ---: | ---: | ---: |');
for (const [name, row] of Object.entries(dev.ablations)) {
  console.log(`| ${name} | ${['candidate', 'p1', 'mrr', 'rp', 'pack', 'bytes'].map((key) => fixed(row[key])).join(' | ')} |`);
}

console.log(`\n## Historical holdout post-mortem (${postMortem.rows.length} tasks)\n`);
console.log('| Earliest observable loss | Relevant file-task pairs | Of which fell out of the pack |');
console.log('| --- | ---: | ---: |');
const losses = postMortem.rows.flatMap((row) => row.losses);
for (const stage of ['candidate', 'ranking', 'budget']) {
  const atStage = losses.filter((loss) => loss.stage === stage);
  console.log(`| ${stage} | ${atStage.length} | ${atStage.filter((loss) => loss.packLost).length} |`);
}
console.log(`\nRelevant candidate losses displaced from the v2 lexical top 64: ${losses.filter((loss) => loss.candidateLost && loss.quota).length}.`);
const promotions = postMortem.rows.flatMap((row) => {
  const oldTop = new Set(row.baseline.ranked.slice(0, 8));
  const nonLabels = row.v2.topNonLabels ?? row.v2.promotedNonLabels;
  return row.v2.selection.ranked.filter((file) => nonLabels.includes(file.path) && !oldTop.has(file.path));
});
console.log(`New top-eight non-labels: ${promotions.length}, including ${promotions.filter((file) => file.reasons.some((reason) => reason.kind === 'graph')).length} with graph points. Weak labels cannot establish that these files were irrelevant.`);
let repeatedEdges = 0;
let graphFiles = 0;
for (const { v2 } of postMortem.rows) {
  const packed = new Set(v2.packed);
  const edges = new Set();
  for (const file of v2.selection.ranked.filter((file) => packed.has(file.path))) {
    const trail = file.reasons.find((reason) => reason.kind === 'graph')?.trail;
    if (!trail) continue;
    graphFiles++;
    for (const edge of trail) {
      const key = JSON.stringify(edge);
      if (edges.has(key)) repeatedEdges++;
      edges.add(key);
    }
  }
}
console.log(`Graph-supported packed entries: ${graphFiles}. Repeated edge citations across their diagnostic trails: ${repeatedEdges}.`);

for (const engine of ['baseline', 'v2']) {
  const rows = postMortem.rows.map((row) => row[engine]);
  const medianOf = (get) => fixed(median(rows.map(get)), 1);
  const explanations = (r) => r.selection.files.reduce((sum, file) => sum + file.explanationBytes, 0);
  console.log(`- ${engine} median instruction payload ${medianOf((r) => r.selection.instructionBytes)} B, file explanation payload ${medianOf(explanations)} B, labelled hits per KiB ${medianOf((r) => r.labelledHitsPerKiB)}.`);
}
if (scaleFile) {
  const scale = read(scaleFile);
  console.log('\n## 5,000-file fixture\n');
  console.log('| Phase | Baseline fresh ms | v2 fresh ms | Baseline warm ms | v2 warm ms |');
  console.log('| --- | ---: | ---: | ---: | ---: |');
  const stageNames = [...new Set(scale.flatMap((row) => Object.keys(row.coldStages)))];
  const sample = (engine, kind, phase) => scale.filter((row) => row.engine === engine).map((row) => row[kind][phase]).filter(Number.isFinite);
  for (const phase of stageNames) {
    const cells = ['coldStages', 'warmStages'].flatMap((kind) => ['baseline', 'v2'].map((engine) => {
      const values = sample(engine, kind, phase);
      return values.length ? fixed(median(values), 1) : '-';
    }));
    console.log(`| ${phase} | ${cells.join(' | ')} |`);
  }
  for (const engine of ['baseline', 'v2']) {
    const rows = scale.filter((row) => row.engine === engine);
    console.log(`\n${engine}: median fresh process ${fixed(median(rows.map((row) => row.coldMs)), 1)} ms, warm compile ${fixed(median(rows.map((row) => row.warmMs)), 1)} ms, peak RSS ${fixed(median(rows.map((row) => row.rssKiB)) / 1024, 1)} MiB.`);
  }
}
