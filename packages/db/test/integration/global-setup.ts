/**
 * Vitest global setup: when `TEST_DATABASE_URL` is set, create that database if
 * it does not exist and apply every migration to it, so integration tests always
 * run against the current schema. Does nothing when the variable is unset.
 */

import 'dotenv/config';

import { execSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import pg from 'pg';

import { TEST_DATABASE_URL, assertTestDatabase } from './database.js';

export default async function setup(): Promise<void> {
  if (TEST_DATABASE_URL === undefined) return;
  assertTestDatabase(TEST_DATABASE_URL);

  const target = new URL(TEST_DATABASE_URL);
  const name = decodeURIComponent(target.pathname.replace(/^\//, ''));
  const admin = new URL(TEST_DATABASE_URL);
  admin.pathname = '/postgres';
  admin.search = '';

  const client = new pg.Client({ connectionString: admin.toString() });
  await client.connect();
  try {
    const exists = await client.query('SELECT 1 FROM pg_database WHERE datname = $1', [name]);
    if (exists.rowCount === 0) await client.query(`CREATE DATABASE "${name.replace(/"/g, '""')}"`);
  } finally {
    await client.end();
  }

  const packageRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
  try {
    execSync('npx prisma migrate deploy', {
      cwd: packageRoot,
      stdio: 'pipe',
      env: { ...process.env, DATABASE_URL: TEST_DATABASE_URL },
    });
  } catch (error) {
    // The CLI can print a whole minified bundle; the cause is in the last lines.
    const stderr = (error as { stderr?: Buffer }).stderr?.toString().trim() ?? String(error);
    const output = stderr.split('\n').slice(-6).join('\n');
    throw new Error(
      `Migrating the test database failed. Prisma 7's CLI needs Node 20.19+, 22.12+ or 24+ ` +
        `(this is ${process.version}); unset TEST_DATABASE_URL to skip the integration tests.\n${output}`,
    );
  }
}
