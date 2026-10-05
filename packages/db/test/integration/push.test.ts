import { afterAll, beforeEach, describe, expect, it } from 'vitest';

import type { PrismaClient } from '../../src/generated/prisma/client.js';
import { getNotificationPrefs, setNotificationPrefs } from '../../src/notification-prefs.js';
import { createNotifier } from '../../src/notify.js';
import { getAccount } from '../../src/profiles.js';
import type { PushMessage, PushSender, PushTicket } from '../../src/push-sender.js';
import { pushTokensFor, registerPushToken, unregisterAllPushTokens, unregisterPushToken } from '../../src/push-tokens.js';
import { sayHello } from '../../src/results.js';
import { seedDatabase } from '../../src/seed.js';
import { createTestClient, hasTestDatabase, resetDatabase } from './database.js';
import { member, roundMatching } from './fixtures.js';

const PHONE = 'ExponentPushToken[sam-phone]';
const TABLET = 'ExponentPushToken[sam-tablet]';
const MAYA = 'ExponentPushToken[maya-phone]';

/** Records what would have been pushed; can answer some tokens as gone. */
function fakeSender(gone: string[] = []) {
  const sent: PushMessage[] = [];
  const sender: PushSender = {
    async send(messages) {
      sent.push(...messages);
      return messages.map((m): PushTicket => (gone.includes(m.to) ? { ok: false, error: 'DeviceNotRegistered' } : { ok: true }));
    },
  };
  return { sent, sender };
}

describe.skipIf(!hasTestDatabase)('push notifications (Postgres)', () => {
  let prisma: PrismaClient;

  beforeEach(async () => {
    prisma ??= createTestClient();
    await resetDatabase(prisma);
    await seedDatabase(prisma);
  });

  afterAll(async () => {
    await prisma?.$disconnect();
  });

  describe('devices', () => {
    it('registers Expo tokens and refuses anything else', async () => {
      const sam = await member(prisma, 'sam@vu.edu.au', 'Sam', 'woman', []);

      expect(await registerPushToken(prisma, sam.userId, PHONE, 'ios')).toEqual({ ok: true });
      expect(await registerPushToken(prisma, sam.userId, 'not-a-token', 'ios')).toEqual({ ok: false, reason: 'invalid' });
      expect(await registerPushToken(prisma, sam.userId, TABLET, 'windows')).toEqual({ ok: false, reason: 'invalid' });
      expect(await pushTokensFor(prisma, [sam.userId])).toEqual(new Map([[sam.userId, [PHONE]]]));
    });

    it('moves a device to whoever signs in on it, and forgets it on sign-out', async () => {
      const sam = await member(prisma, 'sam@vu.edu.au', 'Sam', 'woman', []);
      const maya = await member(prisma, 'maya@vu.edu.au', 'Maya', 'woman', []);
      await registerPushToken(prisma, sam.userId, PHONE, 'android');
      await registerPushToken(prisma, maya.userId, PHONE, 'android');

      const tokens = await pushTokensFor(prisma, [sam.userId, maya.userId]);
      expect(tokens.get(sam.userId)).toBeUndefined();
      expect(tokens.get(maya.userId)).toEqual([PHONE]);

      await unregisterPushToken(prisma, sam.userId, PHONE);
      expect((await pushTokensFor(prisma, [maya.userId])).get(maya.userId)).toEqual([PHONE]);
      await unregisterAllPushTokens(prisma, maya.userId);
      expect(await prisma.pushToken.count()).toBe(0);
    });
  });

  describe('preferences', () => {
    it('starts with everything on, and changes only the kinds given', async () => {
      const sam = await member(prisma, 'sam@vu.edu.au', 'Sam', 'woman', []);
      expect((await getAccount(prisma, sam.userId))?.notifications).toEqual({ messages: true, hellos: true, rounds: true });

      expect(await setNotificationPrefs(prisma, sam.userId, { rounds: false })).toEqual({ messages: true, hellos: true, rounds: false });
      expect(await setNotificationPrefs(prisma, sam.userId, { messages: false, rounds: true })).toEqual({
        messages: false,
        hellos: true,
        rounds: true,
      });
      expect(await getNotificationPrefs(prisma, sam.userId)).toEqual({ messages: false, hellos: true, rounds: true });
    });

    it('is null for an account that does not exist', async () => {
      expect(await setNotificationPrefs(prisma, 'nobody', { messages: false })).toBeNull();
      expect(await getNotificationPrefs(prisma, 'nobody')).toBeNull();
    });
  });

  describe('notifier', () => {
    async function pair() {
      const sam = await member(prisma, 'sam@vu.edu.au', 'Sam', 'woman', []);
      const maya = await member(prisma, 'maya@vu.edu.au', 'Maya', 'woman', []);
      await registerPushToken(prisma, sam.userId, PHONE, 'ios');
      await registerPushToken(prisma, sam.userId, TABLET, 'android');
      await registerPushToken(prisma, maya.userId, MAYA, 'ios');
      const match = await roundMatching(prisma, sam.profileId, maya.profileId);
      return { sam, maya, match };
    }

    it("tells the recipient's every device about a message, without its text", async () => {
      const { maya, match } = await pair();
      const { sent, sender } = fakeSender();

      await createNotifier(prisma, sender).messageSent(match.id, maya.userId);

      expect(sent.map((m) => m.to).sort()).toEqual([TABLET, PHONE].sort());
      expect(sent[0]).toMatchObject({ title: 'HateD', body: 'New message from Maya', data: { type: 'message', matchId: match.id } });
    });

    it('tells the person who said hello first that the conversation is open', async () => {
      const { sam, maya, match } = await pair();
      const { sent, sender } = fakeSender();
      await sayHello(prisma, sam.userId, match.id);
      const second = await sayHello(prisma, maya.userId, match.id);
      expect(second).toMatchObject({ mutual: true, becameMutual: true });
      expect(await sayHello(prisma, maya.userId, match.id)).toMatchObject({ mutual: true, becameMutual: false });

      await createNotifier(prisma, sender).becameMutual(match.id, maya.userId);

      expect(sent.map((m) => m.to).sort()).toEqual([TABLET, PHONE].sort());
      expect(sent[0]).toMatchObject({ title: 'You and Maya both said hello', data: { type: 'mutual', matchId: match.id } });
    });

    it('tells everyone in a published round their result is in', async () => {
      const { match } = await pair();
      const { sent, sender } = fakeSender();

      await createNotifier(prisma, sender).roundPublished(match.roundId);

      expect(sent).toHaveLength(3);
      expect(new Set(sent.map((m) => m.title))).toEqual(new Set(['Your match is here']));
    });

    it('sends nothing of a kind someone turned off, on any of their devices', async () => {
      const { sam, maya, match } = await pair();
      await setNotificationPrefs(prisma, sam.userId, { messages: false, rounds: false });
      const { sent, sender } = fakeSender();
      const notifier = createNotifier(prisma, sender);

      await notifier.messageSent(match.id, maya.userId);
      expect(sent).toEqual([]);

      await notifier.roundPublished(match.roundId);
      expect(sent.map((m) => m.to)).toEqual([MAYA]);

      await sayHello(prisma, sam.userId, match.id);
      await sayHello(prisma, maya.userId, match.id);
      await notifier.becameMutual(match.id, maya.userId);
      expect(sent.map((m) => m.to).slice(1).sort()).toEqual([TABLET, PHONE].sort());
    });

    it('forgets devices the push service says are gone, and never throws', async () => {
      const { maya, match } = await pair();
      const { sender } = fakeSender([TABLET]);

      await createNotifier(prisma, sender, { log: () => undefined }).messageSent(match.id, maya.userId);
      expect(await prisma.pushToken.findMany({ select: { token: true }, orderBy: { token: 'asc' } })).toEqual([
        { token: MAYA },
        { token: PHONE },
      ]);

      const broken: PushSender = { send: async () => Promise.reject(new Error('expo down')) };
      const lines: string[] = [];
      await expect(createNotifier(prisma, broken, { log: (line) => lines.push(line) }).messageSent(match.id, maya.userId)).resolves.toBeUndefined();
      expect(lines[0]).toContain('expo down');
    });
  });
});
