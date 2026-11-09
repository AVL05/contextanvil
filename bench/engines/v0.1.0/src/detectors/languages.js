import { classifyFile } from '../core/classify.js';
import { byCodeUnit } from '../core/paths.js';

export const id = 'languages';

/** Languages are counted from file extensions only; this is stated in each claim. */
export function detect(ctx) {
  const stats = new Map();
  let total = 0;
  for (const f of ctx.files) {
    const { language } = classifyFile(f.path);
    if (!language) continue;
    total++;
    const s = stats.get(language) ?? { files: 0, exts: new Set(), examples: [] };
    s.files++;
    s.exts.add(f.path.endsWith('.blade.php') ? '.blade.php' : f.ext);
    if (s.examples.length < 3) s.examples.push(f.path);
    stats.set(language, s);
  }
  const ordered = [...stats.entries()].sort((a, b) => b[1].files - a[1].files || byCodeUnit(a[0], b[0]));
  for (const [language, s] of ordered) {
    const exts = [...s.exts].sort(byCodeUnit);
    ctx.addFact({
      kind: 'language',
      id: `language:${language.toLowerCase()}`,
      claim: `${language}: ${s.files} file${s.files === 1 ? '' : 's'} (${exts.join(', ')}) by extension`,
      evidence: s.examples.map((path) => ({ path })),
      data: { language, files: s.files, extensions: exts, share: Number((s.files / total).toFixed(3)) },
    });
  }
  ctx.shared.set('languages', new Map(ordered.map(([k, v]) => [k, v.files])));
}
