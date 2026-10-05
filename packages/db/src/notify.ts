/**
 * What a person is told, and when: the push notifications HateD sends.
 *
 * - A new message: "New message from Maya". The text itself is never shown on
 *   the lock screen; a dating app's messages are nobody else's business.
 * - Both said hello: the person who said hello first hears the conversation
 *   is open. A one-sided hello is never announced, as in the app.
 * - A round published: everyone in it hears their result is in.
 *
 * Every notification carries `data.type` (and `matchId` where there is one),
 * which the app uses to open the right screen when tapped. Delivery problems
 * are logged and swallowed: a notification is a courtesy, and must never make
 * the action that caused it fail. Tokens the push service rejects as gone are
 * forgotten. Each kind goes only to people who have not turned it off.
 */

import type { PrismaClient } from './generated/prisma/client.js';
import type { NotificationKind } from './notification-prefs.js';
import type { PushMessage, PushSender } from './push-sender.js';
import { pushTokensFor, removePushTokens } from './push-tokens.js';

export interface Notifier {
  /** `senderUserId` sent a message on `matchId`. */
  messageSent(matchId: string, senderUserId: string): Promise<void>;
  /** `userId`'s hello on `matchId` made it mutual. */
  becameMutual(matchId: string, userId: string): Promise<void>;
  /** Round `roundId` was just published. */
  roundPublished(roundId: string): Promise<void>;
}

/** A notifier that does nothing: tests, and servers with push turned off. */
export const silentNotifier: Notifier = {
  messageSent: async () => undefined,
  becameMutual: async () => undefined,
  roundPublished: async () => undefined,
};

export function createNotifier(
  prisma: PrismaClient,
  sender: PushSender,
  options: { log?: (line: string) => void } = {},
): Notifier {
  const log = options.log ?? ((line: string) => console.error(line));

  /** Send one notification to every device of each person who wants this kind; never throws. */
  async function deliver(
    kind: NotificationKind,
    notes: Array<{ userId: string; title: string; body: string; data: Record<string, string> }>,
  ): Promise<void> {
    try {
      const tokens = await pushTokensFor(prisma, notes.map((note) => note.userId), kind);
      const messages: PushMessage[] = notes.flatMap((note) =>
        (tokens.get(note.userId) ?? []).map((to) => ({ to, title: note.title, body: note.body, data: note.data })),
      );
      if (messages.length === 0) return;

      const tickets = await sender.send(messages);
      const gone = messages.filter((_, index) => {
        const ticket = tickets[index];
        return ticket !== undefined && !ticket.ok && ticket.error === 'DeviceNotRegistered';
      });
      await removePushTokens(prisma, gone.map((message) => message.to));
      const failed = tickets.filter((ticket) => !ticket.ok).length - gone.length;
      if (failed > 0) log(`push: ${failed} of ${messages.length} notifications were refused`);
    } catch (error) {
      log(`push: delivery failed, ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  /** The two sides of a match, as user ids with display names. */
  async function sides(matchId: string) {
    const match = await prisma.match.findUnique({
      where: { id: matchId },
      select: {
        profileA: { select: { userId: true, displayName: true } },
        profileB: { select: { userId: true, displayName: true } },
      },
    });
    return match === null ? null : [match.profileA, match.profileB] as const;
  }

  return {
    async messageSent(matchId, senderUserId) {
      const pair = await sides(matchId).catch(() => null);
      if (pair === null) return;
      const sender = pair.find((side) => side.userId === senderUserId);
      const recipient = pair.find((side) => side.userId !== senderUserId);
      if (sender === undefined || recipient === undefined) return;
      await deliver('messages', [
        { userId: recipient.userId, title: 'HateD', body: `New message from ${sender.displayName}`, data: { type: 'message', matchId } },
      ]);
    },

    async becameMutual(matchId, userId) {
      const pair = await sides(matchId).catch(() => null);
      if (pair === null) return;
      const latest = pair.find((side) => side.userId === userId);
      const first = pair.find((side) => side.userId !== userId);
      if (latest === undefined || first === undefined) return;
      await deliver('hellos', [
        {
          userId: first.userId,
          title: `You and ${latest.displayName} both said hello`,
          body: 'Your conversation is open.',
          data: { type: 'mutual', matchId },
        },
      ]);
    },

    async roundPublished(roundId) {
      const participants = await prisma.matchRoundParticipant
        .findMany({ where: { roundId }, select: { matched: true, profile: { select: { userId: true } } } })
        .catch(() => []);
      await deliver(
        'rounds',
        participants.map((participant) =>
          participant.matched
            ? { userId: participant.profile.userId, title: 'Your match is here', body: "This round's match is ready when you are.", data: { type: 'round' } }
            : { userId: participant.profile.userId, title: "This round's results are in", body: 'Open HateD to see how it went.', data: { type: 'round' } },
        ),
      );
    },
  };
}
