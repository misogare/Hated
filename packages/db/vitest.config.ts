import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { defineConfig } from 'vitest/config';

const coreSrc = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  '../core/src/index.ts',
);

export default defineConfig({
  resolve: {
    alias: {
      // Point at core's source so tests run without building it first.
      '@hated/core': coreSrc,
    },
  },
  test: {
    include: ['test/**/*.test.ts'],
    environment: 'node',
  },
});
