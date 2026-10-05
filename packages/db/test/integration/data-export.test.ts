import { afterAll, beforeEach, describe, expect, it } from 'vitest';

import { saveAnswers, saveDesires } from '../../src/answers.js';
import { sendMessage } from '../../src/chat.js';
import { exportAccount } from '../../src/data-export.js';
import type { PrismaClient } from '../../src/generated/prisma/client.js';
import { reportMatch } from '../../src/matches.js';
import { setNotificationPrefs } from '../../src/notification-prefs.js';
import { registerPushToken } from '../../src/push-tokens.js';
import { sayHello } from '../../src/results.js';
import { seedDatabase } from '../../src/seed.js';
import { createSession, revokeSession } from '../../src/sessions.js';
import { createTestClient, hasTestDatabase, resetDatabase } from './database.js';
import { NOW, member, roundMatching } from './fixtures.js';

describe.skipIf(!hasTestDatabase)('exporting an account (Postgres)', () => {
  let prisma: PrismaClient;

  beforeEach(async () => {
    prisma ??= createTestClient();
    await resetDatabase(prisma);
    await seedDatabase(prisma);
  });

  afterAll(async () => {
    await prisma?.$disconnect();
  });

  /** Sam answered, hoped, matched with Maya and talked, then reported Zara. */
  async function samsHistory() {
    const sam = await member(prisma, 'sam@vu.edu.au', 'Sam', 'woman', ['woman']);
    const maya = await member(prisma, 'maya@vu.edu.au', 'Maya', 'woman', []);
    const zara = await member(prisma, 'zara@vu.edu.au', 'Zara', 'woman', []);

    await saveAnswers(prisma, sam.userId, { humor: 0.8, weekend: 'outdoors' });
    await saveDesires(prisma, sam.userId, { humor: { target: 0.9, weight: 1 } });
    await setNotificationPrefs(prisma, sam.userId, { rounds: false });
    const phone = await createSession(prisma, sam.userId, { now: NOW });
    await createSession(prisma, sam.userId, { now: NOW });
    await revokeSession(prisma, phone.token, { now: NOW });
    await registerPushToken(prisma, sam.userId, 'ExponentPushToken[sam-secret-phone]', 'ios');

    const withMaya = await roundMatching(prisma, sam.profileId, maya.profileId);
    await sayHello(prisma, sam.userId, withMaya.id);
    await sayHello(prisma, maya.userId, withMaya.id);
    await sendMessage(prisma, sam.userId, withMaya.id, 'Hi Maya!');
    await sendMessage(prisma, maya.userId, withMaya.id, 'Hi Sam, from Maya');

    const withZara = await roundMatching(prisma, zara.profileId, sam.profileId);
    await reportMatch(prisma, sam.userId, withZara.id, { reason: 'spam', details: 'Links again.' });
    await reportMatch(prisma, zara.userId, withZara.id, { reason: 'harassment', details: 'Zara says Sam was rude.' });

    return { sam, withMaya, withZara };
  }

  it("holds everything that is the person's", async () => {
    const { sam, withMaya, withZara } = await samsHistory();

    const data = await exportAccount(prisma, sam.userId, { now: NOW });

    expect(data).toMatchObject({
      format: 'hated-export',
      version: 1,
      exportedAt: NOW.toISOString(),
      account: { email: 'sam@vu.edu.au', emailVerified: true, notifications: { messages: true, hellos: true, rounds: false } },
      emailVerifications: [{ email: 'sam@vu.edu.au', institution: 'Victoria University', status: 'VERIFIED' }],
      profile: { displayName: 'Sam', birthDate: '2003-04-20', gender: 'woman', openTo: ['woman'], takingPartInRounds: true },
      hopes: { humor: { target: 0.9, weight: 1 } },
      reportsYouMade: [{ matchId: withZara.id, reason: 'spam', details: 'Links again.', reviewed: false }],
      notificationDevices: [{ platform: 'ios' }],
    });
    expect(data?.answers.map(({ question, answer }) => [question, answer])).toEqual([
      ['humor', 0.8],
      ['weekend', 'outdoors'],
    ]);
    expect(data?.answers[0]?.prompt.length).toBeGreaterThan(0);
    expect(Object.keys(data?.traits ?? {})).toContain('humor');
    expect(data?.rounds).toHaveLength(2);
    expect(data?.signIns.map((signIn) => signIn.signedOutAt !== null)).toEqual([true, false]);

    const [maya, zara] = data?.matches ?? [];
    expect(maya).toMatchObject({ matchId: withMaya.id, conversationOpened: true, youEndedIt: false });
    expect(maya?.messagesYouSent.map((message) => message.body)).toEqual(['Hi Maya!']);
    expect(zara).toMatchObject({ matchId: withZara.id, youSaidHelloAt: null, conversationOpened: false, youEndedIt: true });
  });

  it("leaves out other people's data and every secret", async () => {
    const { sam } = await samsHistory();

    // Sam's own message names Maya; that much is Sam's to keep.
    const text = JSON.stringify(await exportAccount(prisma, sam.userId, { now: NOW })).replace('Hi Maya!', '');

    for (const other of ['Maya', 'Zara', 'maya@vu.edu.au', 'zara@vu.edu.au', 'from Maya', 'rude', 'harassment']) {
      expect(text).not.toContain(other);
    }
    for (const secret of ['sam-secret-phone', 'codeHash', 'tokenHash']) expect(text).not.toContain(secret);
    const hashes = await prisma.session.findMany({ select: { tokenHash: true } });
    for (const { tokenHash } of hashes) expect(text).not.toContain(tokenHash);
  });

  it('works before onboarding, and is null for no account', async () => {
    const user = await prisma.user.create({ data: { email: 'new@vu.edu.au' } });

    expect(await exportAccount(prisma, user.id, { now: NOW })).toMatchObject({
      account: { email: 'new@vu.edu.au', emailVerified: false },
      profile: null,
      answers: [],
      matches: [],
    });
    expect(await exportAccount(prisma, 'nobody')).toBeNull();
  });
});
