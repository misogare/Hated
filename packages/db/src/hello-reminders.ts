/**
 * The reminder before the window to say hello closes. Shortly before a round's
 * window closes (`reminderLeadMs`), everyone in one of its matches who hasn't
 * said hello yet is reminded, once. Nobody who has said hello is, and the
 * reminder never says whether the other person has.
 *
 * Each reminder is claimed in `hello_reminders` before it is sent, so running
 * this often, from a restarted server or from several servers at once, never
 * reminds anyone twice.
 */

import type { PrismaClient } from './generated/prisma/client.js';
import { HELLO_WINDOW_MS, reminderLeadMs, type HelloWindowOptions } from './hello-window.js';
import type { Notifier } from './notify.js';

/** Remind whoever is due a reminder now. Returns how many were sent. */
export async function sendHelloReminders(prisma: PrismaClient, notifier: Notifier, options: HelloWindowOptions = {}): Promise<number> {
  const now = options.now ?? new Date();
  const windowMs = options.helloWindowMs ?? HELLO_WINDOW_MS;
  // Rounds whose window closes within the lead: published more than
  // (window - lead) ago, but less than the whole window ago.
  const closedBefore = new Date(now.getTime() - windowMs);
  const dueSince = new Date(now.getTime() - (windowMs - reminderLeadMs(windowMs)));
  const published = { gt: closedBefore, lte: dueSince };

  const matches = await prisma.match.findMany({
    where: {
      round: { status: 'PUBLISHED', OR: [{ completedAt: published }, { completedAt: null, startedAt: published }] },
      OR: [{ helloAAt: null }, { helloBAt: null }],
    },
    select: {
      id: true,
      profileAId: true,
      profileBId: true,
      helloAAt: true,
      helloBAt: true,
      profileA: { select: { userId: true } },
      profileB: { select: { userId: true } },
    },
  });

  let sent = 0;
  for (const match of matches) {
    // A pass or a report ended it: there's nothing left to say hello to.
    const ended = await prisma.profileBlock.findFirst({
      where: {
        OR: [
          { blockerId: match.profileAId, blockedId: match.profileBId },
          { blockerId: match.profileBId, blockedId: match.profileAId },
        ],
      },
      select: { blockerId: true },
    });
    if (ended !== null) continue;

    const waiting = [
      ...(match.helloAAt === null ? [{ profileId: match.profileAId, userId: match.profileA.userId }] : []),
      ...(match.helloBAt === null ? [{ profileId: match.profileBId, userId: match.profileB.userId }] : []),
    ];
    for (const side of waiting) {
      const claimed = await prisma.helloReminder.createMany({ data: [{ matchId: match.id, profileId: side.profileId, sentAt: now }], skipDuplicates: true });
      if (claimed.count === 0) continue;
      await notifier.helloReminder(match.id, side.userId);
      sent += 1;
    }
  }
  return sent;
}
