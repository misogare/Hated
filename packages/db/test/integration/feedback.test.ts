import { afterAll, beforeEach, describe, expect, it } from 'vitest';

import { feedbackDue, giveFeedback } from '../../src/feedback.js';
import type { PrismaClient } from '../../src/generated/prisma/client.js';
import { passMatch, sayHello } from '../../src/results.js';
import { getRoundReport } from '../../src/round-info.js';
import { seedDatabase } from '../../src/seed.js';
import { createTestClient, hasTestDatabase, resetDatabase } from './database.js';
import { NOW, member, roundMatching } from './fixtures.js';

const DAY = 24 * 60 * 60 * 1000;
/** The first round is published at NOW. */
const after = (ms: number) => new Date(NOW.getTime() + ms);

describe.skipIf(!hasTestDatabase)('how a match went (Postgres)', () => {
  let prisma: PrismaClient;

  beforeEach(async () => {
    prisma ??= createTestClient();
    await resetDatabase(prisma);
    await seedDatabase(prisma);
  });

  afterAll(async () => {
    await prisma?.$disconnect();
  });

  /** Sam and Maya both said hello on this round's match. */
  async function talked() {
    const sam = await member(prisma, 'sam@vu.edu.au', 'Sam', 'woman', []);
    const maya = await member(prisma, 'maya@vu.edu.au', 'Maya', 'woman', []);
    const match = await roundMatching(prisma, sam.profileId, maya.profileId, 'PUBLISHED', NOW);
    await sayHello(prisma, sam.userId, match.id, { now: after(60_000) });
    await sayHello(prisma, maya.userId, match.id, { now: after(120_000) });
    return { sam, maya, match };
  }

  it('asks once the match is in the past: a week on, or once the next round is out', async () => {
    const { sam, maya, match } = await talked();

    expect(await feedbackDue(prisma, sam.userId, { now: after(DAY) })).toBeNull();
    expect(await feedbackDue(prisma, sam.userId, { now: after(7 * DAY) })).toEqual({ matchId: match.id, partnerName: 'Maya' });

    const zara = await member(prisma, 'zara@vu.edu.au', 'Zara', 'woman', []);
    await roundMatching(prisma, maya.profileId, zara.profileId, 'PUBLISHED', after(DAY));
    expect(await feedbackDue(prisma, maya.userId, { now: after(2 * DAY) })).toEqual({ matchId: match.id, partnerName: 'Sam' });
  });

  it('asks each person once: an answer or a skip settles it, and an answer can change', async () => {
    const { sam, maya, match } = await talked();
    const later = { now: after(8 * DAY) };

    expect(await giveFeedback(prisma, sam.userId, match.id, 'well')).toEqual({ ok: true });
    expect(await feedbackDue(prisma, sam.userId, later)).toBeNull();
    expect(await feedbackDue(prisma, maya.userId, later)).toEqual({ matchId: match.id, partnerName: 'Sam' });

    expect(await giveFeedback(prisma, maya.userId, match.id, null)).toEqual({ ok: true });
    expect(await feedbackDue(prisma, maya.userId, later)).toBeNull();

    expect(await giveFeedback(prisma, sam.userId, match.id, 'okay')).toEqual({ ok: true });
    expect((await getRoundReport(prisma, match.roundId))?.feedback).toEqual({ well: 0, okay: 1, notForMe: 0, skipped: 1 });
  });

  it('never asks about a match without both hellos, nor takes an answer for one, or for someone else’s', async () => {
    const sam = await member(prisma, 'sam@vu.edu.au', 'Sam', 'woman', []);
    const maya = await member(prisma, 'maya@vu.edu.au', 'Maya', 'woman', []);
    const zara = await member(prisma, 'zara@vu.edu.au', 'Zara', 'woman', []);
    const oneSided = await roundMatching(prisma, sam.profileId, maya.profileId, 'PUBLISHED', NOW);
    await sayHello(prisma, sam.userId, oneSided.id, { now: after(60_000) });

    expect(await feedbackDue(prisma, sam.userId, { now: after(8 * DAY) })).toBeNull();
    expect(await giveFeedback(prisma, sam.userId, oneSided.id, 'well')).toEqual({ ok: false, reason: 'not-mutual' });
    expect(await giveFeedback(prisma, zara.userId, oneSided.id, 'well')).toEqual({ ok: false, reason: 'not-found' });
    expect(await giveFeedback(prisma, sam.userId, oneSided.id, 'amazing' as never)).toEqual({ ok: false, reason: 'invalid' });
  });

  it('never asks about a match that ended: a pass or a report says enough', async () => {
    const { sam, maya, match } = await talked();
    await passMatch(prisma, maya.userId, match.id);

    expect(await feedbackDue(prisma, sam.userId, { now: after(8 * DAY) })).toBeNull();
    expect(await feedbackDue(prisma, maya.userId, { now: after(8 * DAY) })).toBeNull();
  });
});
