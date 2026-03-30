import { build } from 'esbuild';

const sharedOpts = {
  bundle: true,
  platform: 'node',
  target: 'node20',
  format: 'esm',
  banner: {
    js: [
      '#!/usr/bin/env node',
      'import { createRequire } from "module";',
      'const require = createRequire(import.meta.url);',
    ].join('\n'),
  },
  external: ['better-sqlite3'],
};

// Entry 1: ms (client CLI)
await build({
  ...sharedOpts,
  entryPoints: ['src/cli.ts'],
  outfile: 'dist/cli.js',
});

// Entry 2: ms-agent (worker-side CLI — no better-sqlite3 dependency)
await build({
  ...sharedOpts,
  entryPoints: ['src/agent/agent-cli.ts'],
  outfile: 'dist/agent-cli.js',
  external: [], // ms-agent has no native deps, fully self-contained
});
