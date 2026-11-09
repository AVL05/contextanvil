export const id = 'config-files';

/** [pattern, label, category] applied to repository-root file names. */
const ROOT_CONFIGS = [
  [/^tsconfig(\..+)?\.json$/, 'TypeScript configuration', 'language'],
  [/^jsconfig\.json$/, 'JavaScript project configuration', 'language'],
  [/^(\.eslintrc(\..+)?|eslint\.config\.(js|mjs|cjs|ts|mts|cts))$/, 'ESLint configuration', 'lint'],
  [/^(\.prettierrc(\..+)?|prettier\.config\.(js|mjs|cjs|ts))$/, 'Prettier configuration', 'format'],
  [/^biome\.jsonc?$/, 'Biome configuration', 'lint'],
  [/^\.editorconfig$/, 'EditorConfig', 'format'],
  [/^next\.config\.(js|mjs|cjs|ts)$/, 'Next.js configuration', 'framework'],
  [/^(vite|vitest)\.config\.(js|mjs|cjs|ts|mts)$/, 'Vite/Vitest configuration', 'build'],
  [/^(jest\.config\..+|\.mocharc\..+|playwright\.config\..+|cypress\.config\..+)$/, 'Test runner configuration', 'test'],
  [/^tailwind\.config\..+$/, 'Tailwind CSS configuration', 'build'],
  [/^postcss\.config\..+$/, 'PostCSS configuration', 'build'],
  [/^(babel\.config\..+|\.babelrc(\..+)?)$/, 'Babel configuration', 'build'],
  [/^webpack\.config\..+$/, 'webpack configuration', 'build'],
  [/^(commitlint\.config\..+|\.commitlintrc(\..+)?)$/, 'Commit message lint configuration', 'lint'],
  [/^phpunit\.xml(\.dist)?$/, 'PHPUnit configuration', 'test'],
  [/^phpstan\.neon(\.dist)?$/, 'PHPStan configuration', 'lint'],
  [/^pint\.json$/, 'Laravel Pint configuration', 'format'],
  [/^\.php-cs-fixer(\.dist)?\.php$/, 'PHP CS Fixer configuration', 'format'],
  [/^artisan$/, 'Laravel Artisan console script', 'framework'],
  [/^Dockerfile$/, 'Container build file', 'deploy'],
  [/^(docker-compose|compose)\.ya?ml$/, 'Container composition file', 'deploy'],
  [/^(\.nvmrc|\.node-version)$/, 'Node.js version pin', 'runtime'],
  [/^\.gitignore$/, 'Git ignore rules', 'vcs'],
  [/^\.contextanvilignore$/, 'ContextAnvil ignore rules', 'vcs'],
  [/^\.mcp\.json$/, 'MCP server configuration', 'agent'],
  [/^(vercel\.json|netlify\.toml)$/, 'Deployment configuration', 'deploy'],
  [/^\.env\.(example|sample|template)$/, 'Example environment file', 'env'],
];

const NESTED_CONFIGS = [
  [/^\.claude\/settings(\.local)?\.json$/, 'Claude Code settings', 'agent'],
  [/^\.cursor\/mcp\.json$/, 'Cursor MCP configuration', 'agent'],
  [/^\.vscode\/mcp\.json$/, 'VS Code MCP configuration', 'agent'],
];

export function detect(ctx) {
  for (const f of ctx.files) {
    const rel = f.path;
    const rule = rel.includes('/')
      ? NESTED_CONFIGS.find(([re]) => re.test(rel))
      : ROOT_CONFIGS.find(([re]) => re.test(rel));
    if (!rule) continue;
    const [, label, category] = rule;
    let claim = `${label}: ${rel}`;
    if (/^(\.nvmrc|\.node-version)$/.test(rel)) {
      const value = ctx.read(rel)?.trim().split(/\r?\n/)[0];
      if (value && value.length < 40) claim = `${label}: ${value}`;
    }
    ctx.addFact({
      kind: 'config', id: `config:${rel}`, claim,
      evidence: [{ path: rel }], data: { label, category },
    });
  }

  const workflows = ctx.find((p) => /^\.github\/workflows\/[^/]+\.ya?ml$/.test(p)).map((f) => f.path);
  if (workflows.length) {
    ctx.addFact({
      kind: 'config', id: 'config:github-workflows',
      claim: `GitHub Actions workflows: ${workflows.length} (${workflows.slice(0, 5).join(', ')}${workflows.length > 5 ? ', ...' : ''})`,
      evidence: workflows.slice(0, 5).map((path) => ({ path })),
      data: { label: 'GitHub Actions workflows', category: 'ci', count: workflows.length },
    });
  }
}
