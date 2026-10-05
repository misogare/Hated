import { afterAll, beforeEach, describe, expect, it } from 'vitest';

import { seedDemoPopulation } from '../../src/demo.js';
import type { PrismaClient } from '../../src/generated/prisma/client.js';
import { getLatestResult } from '../../src/results.js';
import { runScheduledRound } from '../../src/scheduled-rounds.js';
import { seedDatabase } from '../../src/seed.js';
import { createTestClient, hasTestDatabase, resetDatabase } from './database.js';

const SLOT = new Date('2026-10-11T09:00:00Z');

describe.skipIf(!hasTestDatabase)('scheduled rounds (Postgres)', () => {
  let prisma: PrismaClient;

  beforeEach(async () => {
    prisma ??= createTestClient();
    await resetDatabase(prisma);
    await seedDatabase(prisma);
  });

  afterAll(async () => {
    await prisma?.$disconnect();
  });

  it('matches the active population and publishes the round for that slot', async () => {
    await seedDemoPopulation(prisma, { count: 12 });

    const result = await runScheduledRound(prisma, SLOT);
    expect(result).toMatchObject({ ran: true, population: 12 });
    if (!result.ran) return;
    expect(result.matched).toBeGreaterThan(0);

    const round = await prisma.matchRound.findUniqueOrThrow({ where: { id: result.roundId } });
    expect(round.status).toBe('PUBLISHED');
    expect(round.scheduledFor).toEqual(SLOT);

    const someone = await prisma.matchRoundParticipant.findFirstOrThrow({
      where: { roundId: result.roundId, matched: true },
      include: { profile: { select: { userId: true } } },
    });
    expect((await getLatestResult(prisma, someone.profile.userId)).status).toBe('matched');
  });

  it('runs a slot only once', async () => {
    await seedDemoPopulation(prisma, { count: 6 });

    expect((await runScheduledRound(prisma, SLOT)).ran).toBe(true);
    expect(await runScheduledRound(prisma, SLOT)).toEqual({ ran: false, reason: 'already-ran' });
    expect(await prisma.matchRound.count()).toBe(1);
  });

  it('lets exactly one of two simultaneous runs win the slot', async () => {
    await seedDemoPopulation(prisma, { count: 6 });

    const results = await Promise.all([runScheduledRound(prisma, SLOT), runScheduledRound(prisma, SLOT)]);
    expect(results.filter((result) => result.ran)).toHaveLength(1);
    expect(results.filter((result) => !result.ran)).toEqual([{ ran: false, reason: 'already-ran' }]);
    expect(await prisma.matchRound.count()).toBe(1);
  });

  it('skips a slot when nobody is active', async () => {
    expect(await runScheduledRound(prisma, SLOT)).toEqual({ ran: false, reason: 'nobody-active' });
    expect(await prisma.matchRound.count()).toBe(0);
  });
});
