import { afterAll, beforeEach, describe, expect, it } from 'vitest';

import type { PrismaClient } from '../../src/generated/prisma/client.js';
import { sendHelloReminders } from '../../src/hello-reminders.js';
import { reminderLeadMs } from '../../src/hello-window.js';
import { silentNotifier, type Notifier } from '../../src/notify.js';
import { passMatch, sayHello } from '../../src/results.js';
import { seedDatabase } from '../../src/seed.js';
import { createTestClient, hasTestDatabase, resetDatabase } from './database.js';
import { NOW, member, roundMatching } from './fixtures.js';

const MINUTE = 60 * 1000;
const HOUR = 60 * MINUTE;
/** These rounds are published at NOW. */
const after = (ms: number) => new Date(NOW.getTime() + ms);

describe('reminderLeadMs', () => {
  it('is 4 hours before the window closes, or a quarter of a shorter window', () => {
    expect(reminderLeadMs(24 * HOUR)).toBe(4 * HOUR);
    expect(reminderLeadMs(12 * HOUR)).toBe(3 * HOUR);
    expect(reminderLeadMs(3 * MINUTE)).toBe(45_000);
  });
});

describe.skipIf(!hasTestDatabase)('reminders before the time to say hello runs out (Postgres)', () => {
  let prisma: PrismaClient;

  beforeEach(async () => {
    prisma ??= createTestClient();
    await resetDatabase(prisma);
    await seedDatabase(prisma);
  });

  afterAll(async () => {
    await prisma?.$disconnect();
  });

  /** A notifier that records who was reminded, and of what. */
  function recorder() {
    const reminded: Array<{ matchId: string; userId: string }> = [];
    const notifier: Notifier = {
      ...silentNotifier,
      helloReminder: async (matchId, userId) => {
        reminded.push({ matchId, userId });
      },
    };
    return { reminded, notifier };
  }

  async function pair(status: 'PUBLISHED' | 'COMPUTED' = 'PUBLISHED') {
    const sam = await member(prisma, 'sam@vu.edu.au', 'Sam', 'woman', []);
    const maya = await member(prisma, 'maya@vu.edu.au', 'Maya', 'woman', []);
    const match = await roundMatching(prisma, sam.profileId, maya.profileId, status, NOW);
    return { sam, maya, match };
  }

  it('reminds both people in the last 4 hours, and only once', async () => {
    const { sam, maya, match } = await pair();
    const { reminded, notifier } = recorder();

    expect(await sendHelloReminders(prisma, notifier, { now: after(19 * HOUR) })).toBe(0);
    expect(await sendHelloReminders(prisma, notifier, { now: after(21 * HOUR) })).toBe(2);
    expect(reminded).toEqual(
      expect.arrayContaining([
        { matchId: match.id, userId: sam.userId },
        { matchId: match.id, userId: maya.userId },
      ]),
    );
    expect(await sendHelloReminders(prisma, notifier, { now: after(23 * HOUR) })).toBe(0);
    expect(reminded).toHaveLength(2);
    expect(await prisma.helloReminder.count()).toBe(2);
  });

  it('reminds only whoever has not said hello', async () => {
    const { sam, maya, match } = await pair();
    await sayHello(prisma, sam.userId, match.id, { now: after(HOUR) });
    const { reminded, notifier } = recorder();

    await sendHelloReminders(prisma, notifier, { now: after(22 * HOUR) });
    expect(reminded).toEqual([{ matchId: match.id, userId: maya.userId }]);
  });

  it('reminds nobody once both have said hello', async () => {
    const { sam, maya, match } = await pair();
    await sayHello(prisma, sam.userId, match.id, { now: after(HOUR) });
    await sayHello(prisma, maya.userId, match.id, { now: after(2 * HOUR) });
    const { reminded, notifier } = recorder();

    await sendHelloReminders(prisma, notifier, { now: after(22 * HOUR) });
    expect(reminded).toEqual([]);
  });

  it('reminds nobody on a match that ended, or once the window has closed', async () => {
    const { sam, match } = await pair();
    const { reminded, notifier } = recorder();

    expect(await sendHelloReminders(prisma, notifier, { now: after(24 * HOUR + MINUTE) })).toBe(0);
    await passMatch(prisma, sam.userId, match.id);
    expect(await sendHelloReminders(prisma, notifier, { now: after(22 * HOUR) })).toBe(0);
    expect(reminded).toEqual([]);
  });

  it('leaves out rounds that were never published', async () => {
    await pair('COMPUTED');
    const { reminded, notifier } = recorder();

    await sendHelloReminders(prisma, notifier, { now: after(22 * HOUR) });
    expect(reminded).toEqual([]);
  });

  it('with a short window, reminds in its last quarter', async () => {
    await pair();
    const { reminded, notifier } = recorder();
    const helloWindowMs = 3 * MINUTE;

    expect(await sendHelloReminders(prisma, notifier, { helloWindowMs, now: after(2 * MINUTE) })).toBe(0);
    expect(await sendHelloReminders(prisma, notifier, { helloWindowMs, now: after(2.5 * MINUTE) })).toBe(2);
    expect(reminded).toHaveLength(2);
  });

  it('reminds once, however many servers ask at the same moment', async () => {
    await pair();
    const { reminded, notifier } = recorder();

    const counts = await Promise.all([1, 2, 3].map(() => sendHelloReminders(prisma, notifier, { now: after(21 * HOUR) })));
    expect(counts.reduce((sum, count) => sum + count, 0)).toBe(2);
    expect(reminded).toHaveLength(2);
  });
});
