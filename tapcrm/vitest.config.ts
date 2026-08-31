import { defineConfig } from 'vitest/config';
import { resolve } from 'node:path';

const repoRoot = process.env.INIT_CWD ?? process.cwd();

export default defineConfig({
  root: repoRoot,
  test: {
    environment: 'node',
    include: ['packages/**/src/**/*.test.ts'],
    // TS-I3: results must be comparable across runs.
    sequence: { shuffle: false },
  },
  resolve: {
    alias: {
      '@tapcrm/contracts': resolve(repoRoot, 'packages/contracts/src/index.ts'),
      '@tapcrm/authz': resolve(repoRoot, 'packages/authz/src/index.ts'),
    },
  },
});
