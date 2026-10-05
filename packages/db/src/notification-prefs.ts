/**
 * Which push notifications a person wants. Each kind can be turned off on its
 * own, for every device at once; the phone's own notification settings still
 * apply on top.
 */

import type { PrismaClient } from './generated/prisma/client.js';

export type NotificationKind = 'messages' | 'hellos' | 'rounds';

export const NOTIFICATION_KINDS: readonly NotificationKind[] = ['messages', 'hellos', 'rounds'];

export type NotificationPrefs = Record<NotificationKind, boolean>;

/** The column on `users` behind each kind. */
export const NOTIFY_COLUMN = {
  messages: 'notifyMessages',
  hellos: 'notifyHellos',
  rounds: 'notifyRounds',
} as const satisfies Record<NotificationKind, string>;

const SELECT = { notifyMessages: true, notifyHellos: true, notifyRounds: true } as const;

function toPrefs(row: { notifyMessages: boolean; notifyHellos: boolean; notifyRounds: boolean }): NotificationPrefs {
  return { messages: row.notifyMessages, hellos: row.notifyHellos, rounds: row.notifyRounds };
}

/** The person's preferences, or null if there is no such account. */
export async function getNotificationPrefs(prisma: PrismaClient, userId: string): Promise<NotificationPrefs | null> {
  const row = await prisma.user.findUnique({ where: { id: userId }, select: SELECT });
  return row === null ? null : toPrefs(row);
}

/** Turn kinds on or off; kinds left out stay as they are. Null if there is no such account. */
export async function setNotificationPrefs(
  prisma: PrismaClient,
  userId: string,
  changes: Partial<NotificationPrefs>,
): Promise<NotificationPrefs | null> {
  const data: Partial<Record<(typeof NOTIFY_COLUMN)[NotificationKind], boolean>> = {};
  for (const kind of NOTIFICATION_KINDS) {
    const value = changes[kind];
    if (value !== undefined) data[NOTIFY_COLUMN[kind]] = value;
  }
  const { count } = await prisma.user.updateMany({ where: { id: userId }, data });
  return count === 0 ? null : getNotificationPrefs(prisma, userId);
}
