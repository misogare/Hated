/**
 * The conversation a match opens once both people have said hello.
 *
 * Messages can only be read or sent on a match the person is part of, in a
 * published round, where both have said hello and neither has passed. Passing
 * ends the conversation for both: its messages stay stored, but neither side
 * can read or add to them any more.
 *
 * The app polls with `after` (the id of the newest message it has), so a
 * cursor is the only paging there is: no offsets to drift as messages arrive.
 * Reading a conversation marks it read for that side, which is what the
 * unread counts on home and in the matches list are measured against.
 */

import type { PrismaClient } from './generated/prisma/client.js';
import { publishLive } from './live.js';
import { findOwnMatch } from './results.js';

/** Longest message accepted, in characters. */
export const MAX_MESSAGE_LENGTH = 2000;

/** Most messages returned by one read. */
const PAGE_SIZE = 100;

export interface MessageView {
  id: string;
  body: string;
  sentAt: string;
  /** Sent by the person reading. */
  mine: boolean;
}

/** Why a conversation is closed to this person. */
export type ChatClosedReason = 'not-found' | 'not-mutual' | 'passed';

export type ListMessagesResult = { ok: true; messages: MessageView[] } | { ok: false; reason: ChatClosedReason };

export type SendMessageResult =
  | { ok: true; message: MessageView }
  | { ok: false; reason: ChatClosedReason }
  | { ok: false; reason: 'invalid'; problem: string };

/**
 * Messages oldest first. Without `after`, the latest page; with it, only the
 * messages that came after that one (an unknown id reads as "from the start").
 */
export async function listMessages(
  prisma: PrismaClient,
  userId: string,
  matchId: string,
  options: { after?: string; now?: Date } = {},
): Promise<ListMessagesResult> {
  const access = await openConversation(prisma, userId, matchId);
  if (!access.ok) return access;

  const cursor =
    options.after === undefined
      ? null
      : await prisma.message.findFirst({ where: { id: options.after, matchId }, select: { id: true, createdAt: true } });

  const rows =
    cursor === null
      ? // The latest page: newest first from the database, flipped below.
        (
          await prisma.message.findMany({
            where: { matchId },
            orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
            take: PAGE_SIZE,
          })
        ).reverse()
      : await prisma.message.findMany({
          where: {
            matchId,
            OR: [{ createdAt: { gt: cursor.createdAt } }, { createdAt: cursor.createdAt, id: { gt: cursor.id } }],
          },
          orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
          take: PAGE_SIZE,
        });

  // A first load, or a poll that brought something, means the person has now
  // seen everything up to this moment.
  if (cursor === null || rows.length > 0) await markRead(prisma, matchId, access.isA, options.now ?? new Date());
  return { ok: true, messages: rows.map((row) => view(row, access.profileId)) };
}

/** Send a message: trimmed, non-empty, at most `MAX_MESSAGE_LENGTH` characters. */
export async function sendMessage(
  prisma: PrismaClient,
  userId: string,
  matchId: string,
  body: string,
  options: { now?: Date } = {},
): Promise<SendMessageResult> {
  const text = body.trim();
  if (text.length === 0) return { ok: false, reason: 'invalid', problem: 'Write something first.' };
  if (text.length > MAX_MESSAGE_LENGTH) {
    return { ok: false, reason: 'invalid', problem: `Keep it under ${MAX_MESSAGE_LENGTH} characters.` };
  }

  const access = await openConversation(prisma, userId, matchId);
  if (!access.ok) return access;

  const row = await prisma.message.create({
    data: { matchId, senderId: access.profileId, body: text, createdAt: options.now ?? new Date() },
  });
  return { ok: true, message: view(row, access.profileId) };
}

export type TypingResult = { ok: true } | { ok: false; reason: ChatClosedReason };

/**
 * Tell the other person this one is writing to them: a live event to them
 * alone, and nothing stored. The same rules as a message apply, so it only
 * ever happens in an open conversation (both said hello, nobody passed).
 */
export async function announceTyping(prisma: PrismaClient, userId: string, matchId: string): Promise<TypingResult> {
  const access = await openConversation(prisma, userId, matchId);
  if (!access.ok) return access;
  const match = await prisma.match.findUniqueOrThrow({
    where: { id: matchId },
    select: { profileA: { select: { userId: true } }, profileB: { select: { userId: true } } },
  });
  await publishLive(prisma, [access.isA ? match.profileB.userId : match.profileA.userId], { type: 'typing', matchId });
  return { ok: true };
}

async function openConversation(
  prisma: PrismaClient,
  userId: string,
  matchId: string,
): Promise<{ ok: true; profileId: string; isA: boolean } | { ok: false; reason: ChatClosedReason }> {
  const match = await findOwnMatch(prisma, userId, matchId);
  if (match === null) return { ok: false, reason: 'not-found' };
  if (match.passed) return { ok: false, reason: 'passed' };
  if (!match.mutual) return { ok: false, reason: 'not-mutual' };
  return { ok: true, profileId: match.profileId, isA: match.isA };
}

async function markRead(prisma: PrismaClient, matchId: string, isA: boolean, at: Date): Promise<void> {
  if (isA) await prisma.match.update({ where: { id: matchId }, data: { readAAt: at } });
  else await prisma.match.update({ where: { id: matchId }, data: { readBAt: at } });
}

function view(row: { id: string; body: string; createdAt: Date; senderId: string }, readerId: string): MessageView {
  return { id: row.id, body: row.body, sentAt: row.createdAt.toISOString(), mine: row.senderId === readerId };
}
