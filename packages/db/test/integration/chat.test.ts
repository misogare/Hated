import { afterAll, beforeEach, describe, expect, it } from 'vitest';

import { listMessages, sendMessage } from '../../src/chat.js';
import type { PrismaClient } from '../../src/generated/prisma/client.js';
import { passMatch, sayHello } from '../../src/results.js';
import { seedDatabase } from '../../src/seed.js';
import { createTestClient, hasTestDatabase, resetDatabase } from './database.js';
import { member, roundMatching } from './fixtures.js';

describe.skipIf(!hasTestDatabase)('chat (Postgres)', () => {
  let prisma: PrismaClient;

  beforeEach(async () => {
    prisma ??= createTestClient();
    await resetDatabase(prisma);
    await seedDatabase(prisma);
  });

  afterAll(async () => {
    await prisma?.$disconnect();
  });

  /** Sam and Maya, matched in a published round. */
  async function pair(options: { hello?: boolean } = {}) {
    const sam = await member(prisma, 'sam@vu.edu.au', 'Sam', 'woman', []);
    const maya = await member(prisma, 'maya@vu.edu.au', 'Maya', 'woman', []);
    const match = await roundMatching(prisma, sam.profileId, maya.profileId);
    if (options.hello ?? true) {
      await sayHello(prisma, sam.userId, match.id);
      await sayHello(prisma, maya.userId, match.id);
    }
    return { sam, maya, matchId: match.id };
  }

  it('stays closed until both have said hello', async () => {
    const { sam, maya, matchId } = await pair({ hello: false });
    await sayHello(prisma, sam.userId, matchId);

    expect(await sendMessage(prisma, sam.userId, matchId, 'hi')).toEqual({ ok: false, reason: 'not-mutual' });
    expect(await listMessages(prisma, maya.userId, matchId)).toEqual({ ok: false, reason: 'not-mutual' });
  });

  it('delivers messages both ways, oldest first, marked by who sent them', async () => {
    const { sam, maya, matchId } = await pair();
    await sendMessage(prisma, sam.userId, matchId, '  Hi Maya!  ', { now: new Date('2026-10-05T10:00:00Z') });
    await sendMessage(prisma, maya.userId, matchId, 'Hi Sam', { now: new Date('2026-10-05T10:01:00Z') });

    const forMaya = await listMessages(prisma, maya.userId, matchId);
    expect(forMaya).toMatchObject({
      ok: true,
      messages: [
        { body: 'Hi Maya!', mine: false, sentAt: '2026-10-05T10:00:00.000Z' },
        { body: 'Hi Sam', mine: true, sentAt: '2026-10-05T10:01:00.000Z' },
      ],
    });
  });

  it('returns only what came after the cursor, including same-millisecond messages', async () => {
    const { sam, maya, matchId } = await pair();
    const at = new Date('2026-10-05T10:00:00Z');
    const first = await sendMessage(prisma, sam.userId, matchId, 'one', { now: at });
    if (!first.ok) throw new Error('send failed');
    await sendMessage(prisma, maya.userId, matchId, 'two', { now: at });
    await sendMessage(prisma, maya.userId, matchId, 'three', { now: new Date('2026-10-05T10:00:01Z') });

    const all = await listMessages(prisma, sam.userId, matchId);
    if (!all.ok) throw new Error('list failed');
    const [one, ...rest] = all.messages.map((message) => message.body);
    expect(all.messages).toHaveLength(3);

    const after = await listMessages(prisma, sam.userId, matchId, { after: all.messages[0]!.id });
    if (!after.ok) throw new Error('list failed');
    expect(after.messages.map((message) => message.body)).toEqual(rest);
    expect([one, ...rest].sort()).toEqual(['one', 'three', 'two']);

    const newest = all.messages.at(-1)!.id;
    expect(await listMessages(prisma, sam.userId, matchId, { after: newest })).toEqual({ ok: true, messages: [] });
  });

  it('rejects empty and overlong messages without storing them', async () => {
    const { sam, matchId } = await pair();

    expect(await sendMessage(prisma, sam.userId, matchId, '   ')).toMatchObject({ ok: false, reason: 'invalid' });
    expect(await sendMessage(prisma, sam.userId, matchId, 'x'.repeat(2001))).toMatchObject({ ok: false, reason: 'invalid' });
    expect(await prisma.message.count()).toBe(0);
  });

  it('closes for both once either passes', async () => {
    const { sam, maya, matchId } = await pair();
    await sendMessage(prisma, sam.userId, matchId, 'hi');
    await passMatch(prisma, maya.userId, matchId);

    expect(await sendMessage(prisma, sam.userId, matchId, 'still there?')).toEqual({ ok: false, reason: 'passed' });
    expect(await listMessages(prisma, sam.userId, matchId)).toEqual({ ok: false, reason: 'passed' });
  });

  it("keeps everyone else out of a conversation", async () => {
    const { matchId } = await pair();
    const eve = await member(prisma, 'eve@vu.edu.au', 'Eve', 'woman', []);

    expect(await listMessages(prisma, eve.userId, matchId)).toEqual({ ok: false, reason: 'not-found' });
    expect(await sendMessage(prisma, eve.userId, matchId, 'hello?')).toEqual({ ok: false, reason: 'not-found' });
  });
});
