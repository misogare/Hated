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
    // Creates and migrates the integration database when TEST_DATABASE_URL is set.
    globalSetup: ['test/integration/global-setup.ts'],
    // Integration files share one database and empty it per test, so files run
    // one at a time. The unit suites are fast enough that this costs little.
    fileParallelism: false,
  },
});
