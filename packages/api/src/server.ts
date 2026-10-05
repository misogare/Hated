#!/usr/bin/env node
/**
 * Run the API: `npm run dev -w @hated/api` (rebuilds, then watches) or
 * `npm start -w @hated/api` after `npm run build`.
 *
 * Settings come from `packages/api/.env`, then `packages/db/.env`, which
 * already holds the database URL and the mail transport; the first file wins.
 * All optional: PORT (3000); HOST (0.0.0.0, so a phone on the same network can
 * reach it); ROUND_DAY / ROUND_TIME / ROUND_TIMEZONE for when rounds close
 * (SUN, 20:00, Australia/Melbourne); ROUND_AUTORUN=false to stop this server
 * running rounds itself; TRUST_PROXY=true behind a reverse proxy, so the
 * per-IP sign-in limits read X-Forwarded-For; and EXPO_ACCESS_TOKEN if the
 * Expo project requires one for sending push notifications.
 */

import path from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  createExpoPushSender,
  createMailer,
  createNotifier,
  createPrismaClient,
  describeMailConfig,
  resolveMailConfig,
  runScheduledRound,
} from '@hated/db';
import { serve } from '@hono/node-server';
import { getConnInfo } from '@hono/node-server/conninfo';
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

/** Behind a proxy every request comes from the proxy, so read the forwarded address. */
const trustProxy = (process.env.TRUST_PROXY ?? 'false').trim().toLowerCase() === 'true';

const prisma = createPrismaClient();
const notifier = createNotifier(
  prisma,
  createExpoPushSender({ accessToken: process.env.EXPO_ACCESS_TOKEN?.trim() || undefined }),
  { log: (line) => console.error(`[push] ${line}`) },
);
const app = createApp({
  notifier,
  services: createDbServices(prisma, createMailer(mailConfig)),
  clientIp: (c) => {
    if (trustProxy) {
      const forwarded = c.req.header('x-forwarded-for')?.split(',')[0]?.trim();
      if (forwarded) return forwarded;
    }
    return getConnInfo(c).remote.address ?? 'unknown';
  },
  schedule,
});

const autorun = (process.env.ROUND_AUTORUN ?? 'true').trim().toLowerCase() !== 'false';
const scheduler = autorun
  ? startRoundScheduler({
      schedule,
      run: async (slot) => {
        const result = await runScheduledRound(prisma, slot);
        if (result.ran) void notifier.roundPublished(result.roundId);
        return result;
      },
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
