import { afterAll, beforeEach, describe, expect, it } from 'vitest';

import type { PrismaClient } from '../../src/generated/prisma/client.js';
import { listMatches } from '../../src/matches.js';
import { describeWindow } from '../../src/notify.js';
import { getLatestResult, getMatch, sayHello } from '../../src/results.js';
import { seedDatabase } from '../../src/seed.js';
import { createTestClient, hasTestDatabase, resetDatabase } from './database.js';
import { NOW, member, roundMatching } from './fixtures.js';

/** These rounds are published at NOW. */
const after = (ms: number) => new Date(NOW.getTime() + ms);
const HOUR = 60 * 60 * 1000;
const DEADLINE = after(24 * HOUR).toISOString();

describe.skipIf(!hasTestDatabase)('the 24 hours to say hello (Postgres)', () => {
  let prisma: PrismaClient;

  beforeEach(async () => {
    prisma ??= createTestClient();
    await resetDatabase(prisma);
    await seedDatabase(prisma);
  });

  afterAll(async () => {
    await prisma?.$disconnect();
  });

  async function pair() {
    const sam = await member(prisma, 'sam@vu.edu.au', 'Sam', 'woman', []);
    const maya = await member(prisma, 'maya@vu.edu.au', 'Maya', 'woman', []);
    const match = await roundMatching(prisma, sam.profileId, maya.profileId, 'PUBLISHED', NOW);
    return { sam, maya, match };
  }

  it('takes a hello up to 24 hours after the round, and none after', async () => {
    const { sam, maya, match } = await pair();

    expect(await sayHello(prisma, sam.userId, match.id, { now: after(23 * HOUR) })).toMatchObject({ ok: true, mutual: false });
    expect(await sayHello(prisma, maya.userId, match.id, { now: after(24 * HOUR + 1) })).toEqual({ ok: false, reason: 'expired' });

    const view = await getMatch(prisma, maya.userId, match.id, { now: after(25 * HOUR) });
    expect(view?.match).toMatchObject({ helloDeadline: DEADLINE, expired: true, mutual: false, saidHello: false });
    // The same words for the one who did say hello: nobody learns who didn't.
    expect((await getMatch(prisma, sam.userId, match.id, { now: after(25 * HOUR) }))?.match).toMatchObject({ expired: true, mutual: false });
  });

  it('still takes a hello at the very end of the window', async () => {
    const { sam, maya, match } = await pair();
    await sayHello(prisma, sam.userId, match.id, { now: after(HOUR) });

    expect(await sayHello(prisma, maya.userId, match.id, { now: after(24 * HOUR) })).toMatchObject({ ok: true, mutual: true });
  });

  it('keeps a match that became mutual in time, for good', async () => {
    const { sam, maya, match } = await pair();
    await sayHello(prisma, sam.userId, match.id, { now: after(2 * HOUR) });
    await sayHello(prisma, maya.userId, match.id, { now: after(20 * HOUR) });

    const later = { now: after(30 * 24 * HOUR) };
    expect((await getMatch(prisma, sam.userId, match.id, later))?.match).toMatchObject({ expired: false, mutual: true, photosUnlocked: true });
    expect(await sayHello(prisma, sam.userId, match.id, later)).toMatchObject({ ok: true, mutual: true });
  });

  it('shows the deadline and whether it passed on home and in the matches list', async () => {
    const { sam, match } = await pair();

    const open = await getLatestResult(prisma, sam.userId, { now: after(HOUR) });
    if (open.status !== 'matched') throw new Error(open.status);
    expect(open.match).toMatchObject({ helloDeadline: DEADLINE, expired: false });

    const closed = await listMatches(prisma, sam.userId, { now: after(25 * HOUR) });
    expect(closed[0]).toMatchObject({ matchId: match.id, helloDeadline: DEADLINE, expired: true });
  });

  it('can be given a shorter window', async () => {
    const { sam, match } = await pair();
    const window = { helloWindowMs: 30 * 60 * 1000 };

    expect(await sayHello(prisma, sam.userId, match.id, { ...window, now: after(31 * 60 * 1000) })).toEqual({ ok: false, reason: 'expired' });
    expect((await getMatch(prisma, sam.userId, match.id, { ...window, now: after(HOUR) }))?.match.helloDeadline).toBe(after(30 * 60 * 1000).toISOString());
  });
});

describe('describeWindow', () => {
  it('says the window in words for the round notification', () => {
    expect(describeWindow(24 * 60 * 60 * 1000)).toBe('24 hours');
    expect(describeWindow(60 * 60 * 1000)).toBe('1 hour');
    expect(describeWindow(30 * 60 * 1000)).toBe('30 minutes');
    expect(describeWindow(90 * 60 * 1000)).toBe('90 minutes');
    expect(describeWindow(20_000)).toBe('1 minute');
  });
});
