#!/usr/bin/env node
/**
 * Run the API: `npm run dev -w @hated/api` (rebuilds, then watches) or
 * `npm start -w @hated/api` after `npm run build`.
 *
 * Settings come from `packages/api/.env`, then `packages/db/.env`, which
 * already holds the database URL and the mail transport; the first file wins.
 * Required here: AUTH_SECRET. Optional: PORT (3000), HOST (0.0.0.0, so a
 * phone on the same network can reach it), and ROUND_DAY / ROUND_TIME /
 * ROUND_TIMEZONE for when rounds close (SUN, 20:00, Australia/Melbourne).
 */

import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { createMailer, createPrismaClient, describeMailConfig, resolveMailConfig } from '@hated/db';
import { serve } from '@hono/node-server';
import { config } from 'dotenv';

import { createApp } from './app.js';
import { parseSchedule } from './schedule.js';
import { createDbServices } from './services.js';
import { MIN_SECRET_LENGTH } from './tokens.js';

const packageRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
config({ path: [path.join(packageRoot, '.env'), path.join(packageRoot, '../db/.env')], quiet: true });

function fail(message: string): never {
  console.error(message);
  process.exit(1);
}

const authSecret = process.env.AUTH_SECRET?.trim() ?? '';
if (authSecret.length < MIN_SECRET_LENGTH) {
  fail(
    `AUTH_SECRET must be set to at least ${MIN_SECRET_LENGTH} characters (in packages/api/.env). Generate one with:\n` +
      `  node -e "console.log(require('crypto').randomBytes(32).toString('base64url'))"`,
  );
}

let schedule;
let mailConfig;
try {
  schedule = parseSchedule(
    process.env.ROUND_DAY ?? 'SUN',
    process.env.ROUND_TIME ?? '20:00',
    process.env.ROUND_TIMEZONE ?? 'Australia/Melbourne',
  );
  mailConfig = resolveMailConfig(process.env);
} catch (error) {
  fail(error instanceof Error ? error.message : String(error));
}

const prisma = createPrismaClient();
const app = createApp({
  services: createDbServices(prisma, createMailer(mailConfig)),
  authSecret,
  schedule,
});

const port = Number(process.env.PORT ?? 3000);
const hostname = process.env.HOST ?? '0.0.0.0';
serve({ fetch: app.fetch, port, hostname }, (info) => {
  console.log(`HateD API on http://${hostname}:${info.port}`);
  console.log(`  mail     ${describeMailConfig(mailConfig)}`);
  console.log(`  rounds   ${process.env.ROUND_DAY ?? 'SUN'} ${process.env.ROUND_TIME ?? '20:00'} ${schedule.timeZone}`);
  if (mailConfig.kind === 'console') console.log('  sign-in codes are printed here, not emailed');
});

const shutdown = async () => {
  await prisma.$disconnect();
  process.exit(0);
};
process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);
