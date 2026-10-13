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
 * per-IP sign-in limits read X-Forwarded-For; EXPO_ACCESS_TOKEN if the Expo
 * project requires one for sending push notifications; PHOTO_DIR for where
 * photos are kept (packages/db/data/photos); and HELLO_WINDOW_HOURS, how long
 * people have to say hello after a round (24; a fraction, e.g. 0.05 for three
 * minutes, is handy for trying it out).
 *
 * Apps also keep a WebSocket open at /live for live updates (see
 * live-server.ts); the events reach it through Postgres, from this server, any
 * other one, or the round CLI.
 */

import type { Server } from 'node:http';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  combineNotifiers,
  createDiskPhotoStore,
  createExpoPushSender,
  createLiveNotifier,
  createMailer,
  createNotifier,
  createPrismaClient,
  defaultPhotoDir,
  describeMailConfig,
  describeWindow,
  listenLive,
  reminderLeadMs,
  resolveMailConfig,
  runScheduledRound,
  sendHelloReminders,
} from '@hated/db';
import { serve } from '@hono/node-server';
import { getConnInfo } from '@hono/node-server/conninfo';
import { config } from 'dotenv';

import { createApp } from './app.js';
import { attachLiveServer } from './live-server.js';
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

const helloWindowHours = Number(process.env.HELLO_WINDOW_HOURS?.trim() || '24');
if (!Number.isFinite(helloWindowHours) || helloWindowHours <= 0) fail('HELLO_WINDOW_HOURS must be a number of hours above 0.');
const helloWindowMs = Math.round(helloWindowHours * 3_600_000);

/** Behind a proxy every request comes from the proxy, so read the forwarded address. */
const trustProxy = (process.env.TRUST_PROXY ?? 'false').trim().toLowerCase() === 'true';

const databaseUrl = process.env.DATABASE_URL?.trim();
if (!databaseUrl) fail('DATABASE_URL is not set (packages/db/.env).');

const prisma = createPrismaClient();
const photoDir = process.env.PHOTO_DIR?.trim() || defaultPhotoDir();
const photos = createDiskPhotoStore(photoDir);
// Every moment goes out twice: as a push (to phones in a pocket) and as a live
// event (to apps that are open).
const notifier = combineNotifiers(
  createNotifier(prisma, createExpoPushSender({ accessToken: process.env.EXPO_ACCESS_TOKEN?.trim() || undefined }), {
    log: (line) => console.error(`[push] ${line}`),
    helloWindowMs,
  }),
  createLiveNotifier(prisma, { log: (line) => console.error(`[live] ${line}`) }),
);
const services = createDbServices(prisma, createMailer(mailConfig), photos, { helloWindowMs });
const app = createApp({
  notifier,
  services,
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

// Shortly before a round's window to say hello closes, remind whoever hasn't
// said hello yet. Each reminder is claimed in the database first, so every
// server can run this, as often as it likes, and nobody hears twice.
const reminderLead = reminderLeadMs(helloWindowMs);
const reminders = setInterval(
  () => {
    sendHelloReminders(prisma, notifier, { helloWindowMs }).then(
      (sent) => {
        if (sent > 0) console.log(`[reminders] reminded ${sent} ${sent === 1 ? 'person' : 'people'} to say hello`);
      },
      (error: unknown) => console.error(`[reminders] failed, ${error instanceof Error ? error.message : String(error)}`),
    );
  },
  // Often enough that even a short trial window (HELLO_WINDOW_HOURS=0.05) gets its reminder.
  Math.max(5_000, Math.min(60_000, Math.floor(reminderLead / 3))),
);

const port = Number(process.env.PORT ?? 3000);
const hostname = process.env.HOST ?? '0.0.0.0';
const server = serve({ fetch: app.fetch, port, hostname }, (info) => {
  console.log(`HateD API on http://${hostname}:${info.port}`);
  console.log(`  mail     ${describeMailConfig(mailConfig)}`);
  console.log(`  photos   ${photoDir}`);
  console.log(
    `  rounds   ${process.env.ROUND_DAY ?? 'SUN'} ${process.env.ROUND_TIME ?? '20:00'} ${schedule.timeZone}, ` +
      (autorun ? `run automatically; next ${nextRoundAt(new Date(), schedule).toISOString()}` : 'run by hand (ROUND_AUTORUN=false)'),
  );
  console.log(`  hello    ${describeWindow(helloWindowMs)} to say hello after a round; a reminder ${describeWindow(reminderLead)} before it closes`);
  if (mailConfig.kind === 'console') console.log('  sign-in codes are printed here, not emailed');
});

const live = attachLiveServer(server as Server, {
  resolveSession: (token) => services.resolveSession(token),
  log: (line) => console.error(`[live] ${line}`),
});
const listener = listenLive(databaseUrl, (userIds, event) => live.deliver(userIds, event), {
  log: (line) => console.error(`[live] ${line}`),
});

const shutdown = async () => {
  scheduler?.stop();
  clearInterval(reminders);
  await listener.stop();
  await live.close();
  await prisma.$disconnect();
  process.exit(0);
};
process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);
