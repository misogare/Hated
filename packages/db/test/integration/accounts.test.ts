import sharp from 'sharp';
import { afterAll, beforeEach, describe, expect, it } from 'vitest';

import { deleteAccount } from '../../src/accounts.js';
import { sendMessage } from '../../src/chat.js';
import type { PrismaClient } from '../../src/generated/prisma/client.js';
import { listMatches, reportMatch } from '../../src/matches.js';
import { createMemoryPhotoStore } from '../../src/photo-store.js';
import { addPhoto } from '../../src/photos.js';
import { registerPushToken } from '../../src/push-tokens.js';
import { listReports } from '../../src/reports.js';
import { getLatestResult, sayHello } from '../../src/results.js';
import { seedDatabase } from '../../src/seed.js';
import { createSession, resolveSession } from '../../src/sessions.js';
import { createTestClient, hasTestDatabase, resetDatabase } from './database.js';
import { member } from './fixtures.js';

describe.skipIf(!hasTestDatabase)('deleting an account (Postgres)', () => {
  let prisma: PrismaClient;
  let store: ReturnType<typeof createMemoryPhotoStore>;

  beforeEach(async () => {
    prisma ??= createTestClient();
    await resetDatabase(prisma);
    await seedDatabase(prisma);
    store = createMemoryPhotoStore();
  });

  afterAll(async () => {
    await prisma?.$disconnect();
  });

  /** A published round matching a and b, started at `at`. */
  async function round(a: string, b: string, at: string) {
    const created = await prisma.matchRound.create({
      data: { status: 'PUBLISHED', objective: 'min-regret', config: {}, population: 2, matched: 2, matchRate: 1, stable: true, startedAt: new Date(at), completedAt: new Date(at) },
    });
    await prisma.matchRoundParticipant.createMany({
      data: [
        { roundId: created.id, profileId: a, side: 'A', matched: true },
        { roundId: created.id, profileId: b, side: 'B', matched: true },
      ],
    });
    return prisma.match.create({ data: { roundId: created.id, profileAId: a, profileBId: b } });
  }

  /**
   * Sam has a session, a phone, three past rounds and a conversation with Maya;
   * Sam reported Lee, and Zara reported Sam.
   */
  async function samsHistory() {
    const sam = await member(prisma, 'sam@vu.edu.au', 'Sam', 'woman', []);
    const lee = await member(prisma, 'lee@vu.edu.au', 'Lee', 'woman', []);
    const zara = await member(prisma, 'zara@vu.edu.au', 'Zara', 'woman', []);
    const maya = await member(prisma, 'maya@vu.edu.au', 'Maya', 'woman', []);

    const session = await createSession(prisma, sam.userId);
    await registerPushToken(prisma, sam.userId, 'ExponentPushToken[sam-phone]', 'ios');
    const photo = await sharp({ create: { width: 600, height: 750, channels: 3, background: '#c08080' } }).jpeg().toBuffer();
    await addPhoto(prisma, store, sam.userId, photo);
    await addPhoto(prisma, store, maya.userId, photo);

    const withLee = await round(sam.profileId, lee.profileId, '2026-09-20T09:00:00Z');
    await reportMatch(prisma, sam.userId, withLee.id, { reason: 'spam', details: 'Kept sending links.' });
    const withZara = await round(zara.profileId, sam.profileId, '2026-09-27T09:00:00Z');
    await reportMatch(prisma, zara.userId, withZara.id, { reason: 'harassment' });

    const withMaya = await round(sam.profileId, maya.profileId, '2026-10-04T09:00:00Z');
    await sayHello(prisma, sam.userId, withMaya.id);
    await sayHello(prisma, maya.userId, withMaya.id);
    await sendMessage(prisma, sam.userId, withMaya.id, 'Hi Maya!');
    await sendMessage(prisma, maya.userId, withMaya.id, 'Hi Sam!');

    return { sam, lee, maya, session, withMaya };
  }

  it('removes everything that is theirs', async () => {
    const { sam, session } = await samsHistory();

    expect(await deleteAccount(prisma, store, sam.userId)).toBe(true);

    expect(await prisma.user.count({ where: { id: sam.userId } })).toBe(0);
    expect(await prisma.profile.count({ where: { id: sam.profileId } })).toBe(0);
    expect(await resolveSession(prisma, session.token)).toBeNull();
    expect(await prisma.session.count({ where: { userId: sam.userId } })).toBe(0);
    expect(await prisma.pushToken.count({ where: { userId: sam.userId } })).toBe(0);
    expect(await prisma.institutionVerification.count({ where: { email: 'sam@vu.edu.au' } })).toBe(0);
    expect(await prisma.matchRoundParticipant.count({ where: { profileId: sam.profileId } })).toBe(0);
    expect(await prisma.match.count({ where: { OR: [{ profileAId: sam.profileId }, { profileBId: sam.profileId }] } })).toBe(0);
    expect(await prisma.message.count()).toBe(0);
    expect(await prisma.profileBlock.count({ where: { OR: [{ blockerId: sam.profileId }, { blockedId: sam.profileId }] } })).toBe(0);
    // Sam's photo files are gone; Maya's stay.
    expect(await prisma.photo.count()).toBe(1);
    expect(store.keys()).toHaveLength(2);
  });

  it('ends the conversation for the other person, without a "no match" that never happened', async () => {
    const { sam, maya } = await samsHistory();
    expect((await getLatestResult(prisma, maya.userId)).status).toBe('matched');

    await deleteAccount(prisma, store, sam.userId);

    expect(await getLatestResult(prisma, maya.userId)).toEqual({ status: 'none' });
    expect(await listMatches(prisma, maya.userId)).toEqual([]);
    // Round totals are counts, not people.
    expect(await prisma.matchRound.count({ where: { population: 2 } })).toBe(3);
  });

  it('keeps reports they made, without their name, and drops reports about them', async () => {
    const { sam } = await samsHistory();

    await deleteAccount(prisma, store, sam.userId);

    const reports = await listReports(prisma);
    expect(reports).toHaveLength(1);
    expect(reports[0]).toMatchObject({ reporter: null, reported: { name: 'Lee' }, reason: 'spam', details: 'Kept sending links.' });
  });

  it('frees the address for a new account, and is false the second time', async () => {
    const { sam } = await samsHistory();

    expect(await deleteAccount(prisma, store, sam.userId)).toBe(true);
    expect(await deleteAccount(prisma, store, sam.userId)).toBe(false);
    await expect(member(prisma, 'sam@vu.edu.au', 'Sam', 'woman', [])).resolves.toBeDefined();
  });
});
