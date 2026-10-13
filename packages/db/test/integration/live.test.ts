import { afterAll, afterEach, beforeEach, describe, expect, it } from 'vitest';

import type { PrismaClient } from '../../src/generated/prisma/client.js';
import { combineNotifiers, createLiveNotifier, listenLive, publishLive, type LiveEvent, type LiveListener } from '../../src/live.js';
import type { Notifier } from '../../src/notify.js';
import { seedDatabase } from '../../src/seed.js';
import { TEST_DATABASE_URL, createTestClient, hasTestDatabase, resetDatabase } from './database.js';
import { member, roundMatching } from './fixtures.js';

describe.skipIf(!hasTestDatabase)('live events through Postgres', () => {
  let prisma: PrismaClient;
  let listener: LiveListener | undefined;
  let heard: Array<{ to: string[]; event: LiveEvent }>;

  /** Start listening, and wait until Postgres has the LISTEN. */
  async function listen(): Promise<void> {
    heard = [];
    await new Promise<void>((resolve) => {
      listener = listenLive(TEST_DATABASE_URL!, (to, event) => heard.push({ to, event }), { onListening: resolve, log: () => undefined });
    });
  }

  /** Wait until `count` notifications have arrived (NOTIFY is asynchronous). */
  async function heardAtLeast(count: number): Promise<void> {
    for (let i = 0; i < 100 && heard.length < count; i++) await new Promise((resolve) => setTimeout(resolve, 20));
    expect(heard.length).toBeGreaterThanOrEqual(count);
  }

  beforeEach(async () => {
    prisma ??= createTestClient();
    await resetDatabase(prisma);
    await seedDatabase(prisma);
    await listen();
  });

  afterEach(async () => {
    await listener?.stop();
  });

  afterAll(async () => {
    await prisma?.$disconnect();
  });

  it('tells both people about a mutual hello, a message and an ended match', async () => {
    const sam = await member(prisma, 'sam@vu.edu.au', 'Sam', 'woman', []);
    const maya = await member(prisma, 'maya@vu.edu.au', 'Maya', 'woman', []);
    const match = await roundMatching(prisma, sam.profileId, maya.profileId);
    const live = createLiveNotifier(prisma);

    await live.becameMutual(match.id, maya.userId);
    await live.messageSent(match.id, sam.userId);
    await live.matchEnded(match.id, maya.userId);
    await heardAtLeast(3);

    expect(heard.map(({ event }) => event)).toEqual([
      { type: 'mutual', matchId: match.id },
      { type: 'message', matchId: match.id },
      { type: 'ended', matchId: match.id },
    ]);
    for (const { to } of heard) expect(to.sort()).toEqual([sam.userId, maya.userId].sort());
  });

  it('tells everyone in a round once it is published', async () => {
    const sam = await member(prisma, 'sam@vu.edu.au', 'Sam', 'woman', []);
    const maya = await member(prisma, 'maya@vu.edu.au', 'Maya', 'woman', []);
    const match = await roundMatching(prisma, sam.profileId, maya.profileId);

    await createLiveNotifier(prisma).roundPublished(match.roundId);
    await heardAtLeast(1);

    expect(heard[0]?.event).toEqual({ type: 'round', roundId: match.roundId });
    expect(heard[0]?.to.sort()).toEqual([sam.userId, maya.userId].sort());
  });

  it('splits a big audience across notifications, and drops repeats', async () => {
    const ids = Array.from({ length: 250 }, (_, index) => `user-${index}`);
    await publishLive(prisma, [...ids, 'user-0'], { type: 'round', roundId: 'r1' });
    await heardAtLeast(3);

    expect(heard).toHaveLength(3);
    expect(heard.flatMap(({ to }) => to).sort()).toEqual(ids.sort());
  });

  it('ignores anything on the channel that is not a live event', async () => {
    await prisma.$executeRaw`SELECT pg_notify('hated_live', 'not json')`;
    await prisma.$executeRaw`SELECT pg_notify('hated_live', ${JSON.stringify({ to: ['u1'], event: { type: 'mutual' } })})`;
    await prisma.$executeRaw`SELECT pg_notify('hated_live', ${JSON.stringify({ to: 'u1', event: { type: 'round', roundId: 'r1' } })})`;
    await publishLive(prisma, ['u1'], { type: 'round', roundId: 'r2' });
    await heardAtLeast(1);
    await new Promise((resolve) => setTimeout(resolve, 100));

    expect(heard).toEqual([{ to: ['u1'], event: { type: 'round', roundId: 'r2' } }]);
  });

  it('can tell several notifiers at once', async () => {
    const calls: string[] = [];
    const recording = (name: string): Notifier => ({
      messageSent: async (matchId) => void calls.push(`${name} message ${matchId}`),
      becameMutual: async (matchId) => void calls.push(`${name} mutual ${matchId}`),
      matchEnded: async (matchId) => void calls.push(`${name} ended ${matchId}`),
      roundPublished: async (roundId) => void calls.push(`${name} round ${roundId}`),
    });

    const both = combineNotifiers(recording('push'), recording('live'));
    await both.becameMutual('m1', 'u1');
    await both.roundPublished('r1');

    expect(calls).toEqual(['push mutual m1', 'live mutual m1', 'push round r1', 'live round r1']);
  });
});
