import 'dotenv/config';

import { defineConfig } from 'prisma/config';

/**
 * Prisma ORM v7 configuration.
 *
 * `url` moved out of the `datasource` block in schema.prisma and lives here.
 * We read `process.env.DATABASE_URL` directly instead of the `env()` helper so
 * that `prisma generate` (which needs no connection) still works when the
 * variable is unset, e.g. in CI type-check jobs.
 */
export default defineConfig({
  schema: 'prisma/schema.prisma',
  migrations: {
    path: 'prisma/migrations',
    seed: 'tsx src/seed.ts',
  },
  datasource: {
    url: process.env.DATABASE_URL ?? '',
  },
});
