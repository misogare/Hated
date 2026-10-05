import { afterAll, beforeEach, describe, expect, it } from 'vitest';

import { saveAnswers } from '../../src/answers.js';
import type { PrismaClient } from '../../src/generated/prisma/client.js';
import { getLatestResult, passMatch, sayHello } from '../../src/results.js';
import { seedDatabase } from '../../src/seed.js';
import { createTestClient, hasTestDatabase, resetDatabase } from './database.js';
import { NOW, member, roundMatching } from './fixtures.js';

describe.skipIf(!hasTestDatabase)('round results (Postgres)', () => {
  let prisma: PrismaClient;

  beforeEach(async () => {
    prisma ??= createTestClient();
    await resetDatabase(prisma);
    await seedDatabase(prisma);
  });

  afterAll(async () => {
    await prisma?.$disconnect();
  });

  it('shows nothing until a round with this person is published', async () => {
    const sam = await member(prisma, 'sam@vu.edu.au', 'Sam', 'woman', []);
    const alex = await member(prisma, 'alex@vu.edu.au', 'Alex', 'man', []);
    expect(await getLatestResult(prisma, sam.userId)).toEqual({ status: 'none' });

    await roundMatching(prisma, sam.profileId, alex.profileId, 'COMPUTED');
    expect(await getLatestResult(prisma, sam.userId)).toEqual({ status: 'none' });
  });

  it('reveals the match with age, institution and reasons', async () => {
    const sam = await member(prisma, 'sam@vu.edu.au', 'Sam', 'woman', []);
    const maya = await member(prisma, 'maya@vu.edu.au', 'Maya', 'woman', []);
    await saveAnswers(prisma, sam.userId, { humor: 0.9 });
    await saveAnswers(prisma, maya.userId, { humor: 0.85 });
    const match = await roundMatching(prisma, sam.profileId, maya.profileId);

    const result = await getLatestResult(prisma, sam.userId, { now: NOW });
    expect(result).toMatchObject({
      status: 'matched',
      match: {
        matchId: match.id,
        partner: { displayName: 'Maya', age: 23, institution: 'Victoria University' },
        reasons: ['You both lead with humor'],
        saidHello: false,
        mutual: false,
        passed: false,
      },
    });
  });

  it('reports an unmatched round with its reason', async () => {
    const sam = await member(prisma, 'sam@vu.edu.au', 'Sam', 'woman', []);
    const round = await prisma.matchRound.create({
      data: { status: 'PUBLISHED', objective: 'min-regret', config: {}, population: 1, matched: 0, matchRate: 0, stable: true },
    });
    await prisma.matchRoundParticipant.create({
      data: { roundId: round.id, profileId: sam.profileId, side: 'A', matched: false, unmatchedReason: 'no-eligible-candidates' },
    });

    expect(await getLatestResult(prisma, sam.userId)).toMatchObject({ status: 'unmatched', reason: 'no-eligible-candidates' });
  });

  it('opens up only when both say hello, and never reveals a one-sided hello', async () => {
    const sam = await member(prisma, 'sam@vu.edu.au', 'Sam', 'woman', []);
    const maya = await member(prisma, 'maya@vu.edu.au', 'Maya', 'woman', []);
    const match = await roundMatching(prisma, sam.profileId, maya.profileId);

    expect(await sayHello(prisma, maya.userId, match.id)).toEqual({ ok: true, mutual: false, becameMutual: false });
    expect(await getLatestResult(prisma, sam.userId)).toMatchObject({ match: { saidHello: false, mutual: false } });

    expect(await sayHello(prisma, sam.userId, match.id)).toEqual({ ok: true, mutual: true, becameMutual: true });
    expect(await getLatestResult(prisma, maya.userId)).toMatchObject({ match: { saidHello: true, mutual: true } });
  });

  it('passing blocks the pair and stops hellos', async () => {
    const sam = await member(prisma, 'sam@vu.edu.au', 'Sam', 'woman', []);
    const maya = await member(prisma, 'maya@vu.edu.au', 'Maya', 'woman', []);
    const match = await roundMatching(prisma, sam.profileId, maya.profileId);

    expect(await passMatch(prisma, sam.userId, match.id)).toEqual({ ok: true, mutual: false });
    expect(await passMatch(prisma, sam.userId, match.id)).toEqual({ ok: true, mutual: false });
    expect(await prisma.profileBlock.count()).toBe(1);
    expect(await getLatestResult(prisma, maya.userId)).toMatchObject({ match: { passed: true } });
    expect(await sayHello(prisma, maya.userId, match.id)).toEqual({ ok: false, reason: 'passed' });
  });

  it("treats someone else's match, or an unpublished one, as not found", async () => {
    const sam = await member(prisma, 'sam@vu.edu.au', 'Sam', 'woman', []);
    const maya = await member(prisma, 'maya@vu.edu.au', 'Maya', 'woman', []);
    const eve = await member(prisma, 'eve@vu.edu.au', 'Eve', 'woman', []);
    const match = await roundMatching(prisma, sam.profileId, maya.profileId);
    const draft = await roundMatching(prisma, sam.profileId, eve.profileId, 'COMPUTED');

    expect(await sayHello(prisma, eve.userId, match.id)).toEqual({ ok: false, reason: 'not-found' });
    expect(await passMatch(prisma, eve.userId, match.id)).toEqual({ ok: false, reason: 'not-found' });
    expect(await sayHello(prisma, sam.userId, draft.id)).toEqual({ ok: false, reason: 'not-found' });
  });
});
