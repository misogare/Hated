/**
 * Shared plumbing for tests that run against a real Postgres.
 *
 * They run only when `TEST_DATABASE_URL` is set (see `.env.example`) and are
 * skipped otherwise, so `npm test` stays green on a machine with no database.
 * Every test empties the tables first, so the URL must name a database meant
 * for that: its name has to contain "test", which keeps a typo from wiping
 * development data.
 */

import 'dotenv/config';

import { createPrismaClient, type PrismaClient } from '../../src/index.js';

export const TEST_DATABASE_URL = process.env.TEST_DATABASE_URL?.trim() || undefined;

/** True when integration tests should run. */
export const hasTestDatabase = TEST_DATABASE_URL !== undefined;

/** Throws unless the URL points at a database whose name says it is for tests. */
export function assertTestDatabase(url: string): void {
  const name = new URL(url).pathname.replace(/^\//, '');
  if (!/test/i.test(name)) {
    throw new Error(`TEST_DATABASE_URL must name a test database (got "${name}"); its tables are emptied by every test.`);
  }
}

export function createTestClient(): PrismaClient {
  if (TEST_DATABASE_URL === undefined) throw new Error('TEST_DATABASE_URL is not set');
  assertTestDatabase(TEST_DATABASE_URL);
  return createPrismaClient({ connectionString: TEST_DATABASE_URL });
}

/** Empty every application table, so each test starts from nothing. */
export async function resetDatabase(prisma: PrismaClient): Promise<void> {
  const tables = await prisma.$queryRaw<Array<{ tablename: string }>>`
    SELECT tablename FROM pg_tables
    WHERE schemaname = 'public' AND tablename <> '_prisma_migrations'`;
  if (tables.length === 0) return;
  const list = tables.map(({ tablename }) => `"public"."${tablename.replace(/"/g, '""')}"`).join(', ');
  await prisma.$executeRawUnsafe(`TRUNCATE ${list} RESTART IDENTITY CASCADE`);
}
