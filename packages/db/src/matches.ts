/**
 * Every match a person has had, not just this round's, and reporting one.
 *
 * Home shows the latest round; this is the history behind it, so a
 * conversation from an earlier round stays reachable after a new round
 * publishes. Each entry carries what a list needs: who, where things stand,
 * the last message and how many are unread.
 *
 * Reporting records the report for review and ends the match exactly as a
 * pass does, so the two are never matched again and the conversation closes
 * for both.
 */

import type { PrismaClient } from './generated/prisma/client.js';
import { HELLO_WINDOW_MS, helloDeadline, helloExpired, type HelloWindowOptions } from './hello-window.js';
import type { PhotoView } from './photos.js';
import { ageOn } from './profiles.js';
import { findOwnMatch } from './results.js';
import { countUnread } from './unread.js';

export const REPORT_REASONS = ['harassment', 'inappropriate', 'spam', 'unsafe', 'other'] as const;
export type ReportReason = (typeof REPORT_REASONS)[number];

const MAX_DETAILS_LENGTH = 1000;

export interface MatchSummary {
  matchId: string;
  roundId: string;
  publishedAt: string;
  partner: {
    displayName: string;
    age: number;
    institution: string | null;
    /** Their main photo; none once the match has ended. */
    photo: PhotoView | null;
  };
  saidHello: boolean;
  mutual: boolean;
  passed: boolean;
  /** Both said hello and neither passed: the photo can be seen in full, not just blurred. */
  photosUnlocked: boolean;
  /** When the window to say hello closes. */
  helloDeadline: string;
  /** The window closed before both said hello: the match is over. */
  expired: boolean;
  lastMessage: { body: string; sentAt: string; mine: boolean } | null;
  /** Messages from the partner since this person last read the conversation. */
  unread: number;
}

export type ReportResult = { ok: true } | { ok: false; reason: 'not-found' } | { ok: false; reason: 'invalid'; problem: string };

/** All of this person's matches from published rounds, newest round first. */
export async function listMatches(prisma: PrismaClient, userId: string, options: HelloWindowOptions = {}): Promise<MatchSummary[]> {
  const profile = await prisma.profile.findUnique({ where: { userId }, select: { id: true } });
  if (profile === null) return [];
  const me = profile.id;
  const now = options.now ?? new Date();

  const partnerSelect = {
    id: true,
    displayName: true,
    birthDate: true,
    photos: { orderBy: { position: 'asc' as const }, take: 1, select: { id: true, width: true, height: true } },
    user: {
      select: {
        verifications: {
          where: { status: 'VERIFIED' as const },
          orderBy: { verifiedAt: 'desc' as const },
          take: 1,
          select: { institution: { select: { name: true } } },
        },
      },
    },
  };
  const matches = await prisma.match.findMany({
    where: { round: { status: 'PUBLISHED' }, OR: [{ profileAId: me }, { profileBId: me }] },
    orderBy: { round: { startedAt: 'desc' } },
    include: {
      round: { select: { startedAt: true, completedAt: true } },
      profileA: { select: partnerSelect },
      profileB: { select: partnerSelect },
      messages: { orderBy: [{ createdAt: 'desc' }, { id: 'desc' }], take: 1 },
    },
  });
  if (matches.length === 0) return [];

  const blocks = await prisma.profileBlock.findMany({
    where: { OR: [{ blockerId: me }, { blockedId: me }] },
    select: { blockerId: true, blockedId: true },
  });
  const blocked = new Set(blocks.map((block) => (block.blockerId === me ? block.blockedId : block.blockerId)));

  return Promise.all(
    matches.map(async (match) => {
      const isA = match.profileAId === me;
      const partner = isA ? match.profileB : match.profileA;
      const mine = isA ? match.helloAAt : match.helloBAt;
      const theirs = isA ? match.helloBAt : match.helloAAt;
      const last = match.messages[0];
      const passed = blocked.has(partner.id);
      const mutual = mine !== null && theirs !== null;
      const deadline = helloDeadline(match.round, options.helloWindowMs ?? HELLO_WINDOW_MS);
      return {
        matchId: match.id,
        roundId: match.roundId,
        publishedAt: (match.round.completedAt ?? match.round.startedAt).toISOString(),
        partner: {
          displayName: partner.displayName,
          age: ageOn(partner.birthDate, now),
          institution: partner.user.verifications[0]?.institution?.name ?? null,
          photo: passed ? null : (partner.photos[0] ?? null),
        },
        saidHello: mine !== null,
        mutual,
        passed,
        photosUnlocked: mutual && !passed,
        helloDeadline: deadline.toISOString(),
        expired: helloExpired(deadline, mutual, now),
        lastMessage: last === undefined ? null : { body: last.body, sentAt: last.createdAt.toISOString(), mine: last.senderId === me },
        unread: await countUnread(prisma, match.id, partner.id, isA ? match.readAAt : match.readBAt),
      };
    }),
  );
}

/** Report a match for review and end it, as a pass does. */
export async function reportMatch(
  prisma: PrismaClient,
  userId: string,
  matchId: string,
  input: { reason: string; details?: string },
): Promise<ReportResult> {
  if (!(REPORT_REASONS as readonly string[]).includes(input.reason)) {
    return { ok: false, reason: 'invalid', problem: 'Choose a reason.' };
  }
  const details = input.details?.trim() || null;
  if (details !== null && details.length > MAX_DETAILS_LENGTH) {
    return { ok: false, reason: 'invalid', problem: `Keep the details under ${MAX_DETAILS_LENGTH} characters.` };
  }

  const match = await findOwnMatch(prisma, userId, matchId);
  if (match === null) return { ok: false, reason: 'not-found' };

  await prisma.$transaction([
    prisma.report.create({
      data: { reporterId: match.profileId, reportedId: match.partnerId, matchId, reason: input.reason, details },
    }),
    prisma.profileBlock.upsert({
      where: { blockerId_blockedId: { blockerId: match.profileId, blockedId: match.partnerId } },
      create: { blockerId: match.profileId, blockedId: match.partnerId, reason: `reported:${input.reason}` },
      update: {},
    }),
  ]);
  return { ok: true };
}
