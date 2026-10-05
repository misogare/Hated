#!/usr/bin/env node
/**
 * Run the API: `npm run dev -w @hated/api` (rebuilds, then watches) or
 * `npm start -w @hated/api` after `npm run build`.
 *
 * Settings come from `packages/api/.env`, then `packages/db/.env`, which
 * already holds the database URL and the mail transport; the first file wins.
 * Optional here: PORT (3000), HOST (0.0.0.0, so a
 * phone on the same network can reach it), ROUND_DAY / ROUND_TIME /
 * ROUND_TIMEZONE for when rounds close (SUN, 20:00, Australia/Melbourne), and
 * ROUND_AUTORUN=false to stop this server running rounds itself.
 */

import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { createMailer, createPrismaClient, describeMailConfig, resolveMailConfig, runScheduledRound } from '@hated/db';
import { serve } from '@hono/node-server';
import { config } from 'dotenv';

import { createApp } from './app.js';
import { startRoundScheduler } from './round-scheduler.js';
import { nextRoundAt, parseSchedule } from './schedule.js';
import { createDbServices } from './services.js';

const packageRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
config({ path: [path.join(packageRoot, '.env'), path.join(packageRoot, '../db/.env')], quiet: true });

function fail(message: string): never {
  console.error(message);
  process.exit(1);
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
  schedule,
});

const autorun = (process.env.ROUND_AUTORUN ?? 'true').trim().toLowerCase() !== 'false';
const scheduler = autorun
  ? startRoundScheduler({
      schedule,
      run: (slot) => runScheduledRound(prisma, slot),
      log: (line) => console.log(`[rounds] ${line}`),
    })
  : null;

const port = Number(process.env.PORT ?? 3000);
const hostname = process.env.HOST ?? '0.0.0.0';
serve({ fetch: app.fetch, port, hostname }, (info) => {
  console.log(`HateD API on http://${hostname}:${info.port}`);
  console.log(`  mail     ${describeMailConfig(mailConfig)}`);
  console.log(
    `  rounds   ${process.env.ROUND_DAY ?? 'SUN'} ${process.env.ROUND_TIME ?? '20:00'} ${schedule.timeZone}, ` +
      (autorun ? `run automatically; next ${nextRoundAt(new Date(), schedule).toISOString()}` : 'run by hand (ROUND_AUTORUN=false)'),
  );
  if (mailConfig.kind === 'console') console.log('  sign-in codes are printed here, not emailed');
});

const shutdown = async () => {
  scheduler?.stop();
  await prisma.$disconnect();
  process.exit(0);
};
process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);
