import { defineConfig } from 'vitest/config';
import { resolve } from 'node:path';

export default defineConfig({
  test: {
    environment: 'node',
    include: ['packages/**/src/**/*.test.ts'],
    // TS-I3: results must be comparable across runs.
    sequence: { shuffle: false },
  },
  resolve: {
    alias: {
      '@tapcrm/contracts': resolve(__dirname, 'packages/contracts/src/index.ts'),
      '@tapcrm/authz': resolve(__dirname, 'packages/authz/src/index.ts'),
    },
  },
});
