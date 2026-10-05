import { afterAll, beforeEach, describe, expect, it } from 'vitest';

import { listMessages, sendMessage } from '../../src/chat.js';
import type { PrismaClient } from '../../src/generated/prisma/client.js';
import { listMatches, reportMatch } from '../../src/matches.js';
import { getLatestResult, sayHello } from '../../src/results.js';
import { seedDatabase } from '../../src/seed.js';
import { createTestClient, hasTestDatabase, resetDatabase } from './database.js';
import { member } from './fixtures.js';

describe.skipIf(!hasTestDatabase)('match history, unread and reports (Postgres)', () => {
  let prisma: PrismaClient;

  beforeEach(async () => {
    prisma ??= createTestClient();
    await resetDatabase(prisma);
    await seedDatabase(prisma);
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

  async function mutual(matchId: string, ...userIds: string[]) {
    for (const userId of userIds) await sayHello(prisma, userId, matchId);
  }

  it('lists every match from published rounds, newest first, so earlier chats stay reachable', async () => {
    const sam = await member(prisma, 'sam@vu.edu.au', 'Sam', 'woman', []);
    const maya = await member(prisma, 'maya@vu.edu.au', 'Maya', 'woman', []);
    const zara = await member(prisma, 'zara@vu.edu.au', 'Zara', 'woman', []);
    const first = await round(sam.profileId, maya.profileId, '2026-09-27T09:00:00Z');
    const second = await round(sam.profileId, zara.profileId, '2026-10-04T09:00:00Z');
    await mutual(first.id, sam.userId, maya.userId);
    await sendMessage(prisma, maya.userId, first.id, 'Still up for coffee?');

    const matches = await listMatches(prisma, sam.userId);
    expect(matches.map((match) => [match.matchId, match.partner.displayName])).toEqual([
      [second.id, 'Zara'],
      [first.id, 'Maya'],
    ]);
    expect(matches[1]).toMatchObject({
      mutual: true,
      lastMessage: { body: 'Still up for coffee?', mine: false },
      unread: 1,
    });
    expect(await listMessages(prisma, sam.userId, first.id)).toMatchObject({ ok: true });
  });

  it('counts unread messages until the conversation is read', async () => {
    const sam = await member(prisma, 'sam@vu.edu.au', 'Sam', 'woman', []);
    const maya = await member(prisma, 'maya@vu.edu.au', 'Maya', 'woman', []);
    const match = await round(sam.profileId, maya.profileId, '2026-10-04T09:00:00Z');
    await mutual(match.id, sam.userId, maya.userId);

    await sendMessage(prisma, maya.userId, match.id, 'one', { now: new Date('2026-10-05T10:00:00Z') });
    await sendMessage(prisma, maya.userId, match.id, 'two', { now: new Date('2026-10-05T10:01:00Z') });
    await sendMessage(prisma, sam.userId, match.id, 'mine', { now: new Date('2026-10-05T10:02:00Z') });
    expect(await getLatestResult(prisma, sam.userId)).toMatchObject({ match: { unread: 2 } });

    await listMessages(prisma, sam.userId, match.id, { now: new Date('2026-10-05T10:05:00Z') });
    expect(await getLatestResult(prisma, sam.userId)).toMatchObject({ match: { unread: 0 } });

    await sendMessage(prisma, maya.userId, match.id, 'three', { now: new Date('2026-10-05T10:06:00Z') });
    expect((await listMatches(prisma, sam.userId))[0]!.unread).toBe(1);
    // Maya's own messages never count as unread for her.
    expect((await listMatches(prisma, maya.userId))[0]!.unread).toBe(1);
  });

  it('records a report, ends the match and closes the conversation', async () => {
    const sam = await member(prisma, 'sam@vu.edu.au', 'Sam', 'woman', []);
    const maya = await member(prisma, 'maya@vu.edu.au', 'Maya', 'woman', []);
    const match = await round(sam.profileId, maya.profileId, '2026-10-04T09:00:00Z');
    await mutual(match.id, sam.userId, maya.userId);

    expect(await reportMatch(prisma, sam.userId, match.id, { reason: 'harassment', details: '  rude messages ' })).toEqual({ ok: true });

    const report = await prisma.report.findFirstOrThrow();
    expect(report).toMatchObject({ reporterId: sam.profileId, reportedId: maya.profileId, matchId: match.id, reason: 'harassment', details: 'rude messages', resolvedAt: null });
    expect(await prisma.profileBlock.count({ where: { blockerId: sam.profileId, blockedId: maya.profileId } })).toBe(1);
    expect(await sendMessage(prisma, maya.userId, match.id, 'hello?')).toEqual({ ok: false, reason: 'passed' });
    expect((await listMatches(prisma, maya.userId))[0]!.passed).toBe(true);
  });

  it('refuses an unknown reason, overlong details, and other people’s matches', async () => {
    const sam = await member(prisma, 'sam@vu.edu.au', 'Sam', 'woman', []);
    const maya = await member(prisma, 'maya@vu.edu.au', 'Maya', 'woman', []);
    const eve = await member(prisma, 'eve@vu.edu.au', 'Eve', 'woman', []);
    const match = await round(sam.profileId, maya.profileId, '2026-10-04T09:00:00Z');

    expect(await reportMatch(prisma, sam.userId, match.id, { reason: 'boring' })).toMatchObject({ ok: false, reason: 'invalid' });
    expect(await reportMatch(prisma, sam.userId, match.id, { reason: 'other', details: 'x'.repeat(1001) })).toMatchObject({ ok: false, reason: 'invalid' });
    expect(await reportMatch(prisma, eve.userId, match.id, { reason: 'spam' })).toEqual({ ok: false, reason: 'not-found' });
    expect(await prisma.report.count()).toBe(0);
  });
});

describe.skipIf(!hasTestDatabase)('reviewing reports (Postgres)', () => {
  let prisma: PrismaClient;

  beforeEach(async () => {
    prisma ??= createTestClient();
    await resetDatabase(prisma);
    await seedDatabase(prisma);
  });

  afterAll(async () => {
    await prisma?.$disconnect();
  });

  it('lists open reports with who and why, counts repeat reports, and resolves them', async () => {
    const { listReports, resolveReport } = await import('../../src/reports.js');
    const sam = await member(prisma, 'sam@vu.edu.au', 'Sam', 'woman', []);
    const zara = await member(prisma, 'zara@vu.edu.au', 'Zara', 'woman', []);
    const max = await member(prisma, 'max@vu.edu.au', 'Max', 'man', []);
    for (const [reporter, at] of [[sam, '2026-09-27T09:00:00Z'], [zara, '2026-10-04T09:00:00Z']] as const) {
      const round = await prisma.matchRound.create({
        data: { status: 'PUBLISHED', objective: 'min-regret', config: {}, population: 2, matched: 2, matchRate: 1, stable: true, startedAt: new Date(at) },
      });
      const match = await prisma.match.create({ data: { roundId: round.id, profileAId: reporter.profileId, profileBId: max.profileId } });
      await reportMatch(prisma, reporter.userId, match.id, { reason: 'harassment', details: `from ${reporter.userId === sam.userId ? 'Sam' : 'Zara'}` });
    }

    const open = await listReports(prisma);
    expect(open.map((report) => [report.reporter.name, report.reported.name, report.reportsAboutThem])).toEqual([
      ['Sam', 'Max', 2],
      ['Zara', 'Max', 2],
    ]);

    expect(await resolveReport(prisma, open[0]!.id)).toBe(true);
    expect((await listReports(prisma)).map((report) => report.reporter.name)).toEqual(['Zara']);
    expect(await listReports(prisma, { includeResolved: true })).toHaveLength(2);
    expect(await resolveReport(prisma, 'no-such-report')).toBe(false);
  });
});
