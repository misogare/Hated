/**
 * How a match went, asked once. After a match where both said hello, the next
 * round (or a week, for someone sitting rounds out) brings one light question
 * about it: really well, okay, or not for me. Only HateD sees the answer, never
 * the other person.
 *
 * It's recorded per match as a signal for tuning the matching. For now it
 * changes nothing by itself; `round:inspect` shows each round's answers.
 */

import type { PrismaClient } from './generated/prisma/client.js';
import { findOwnMatch } from './results.js';

export const FEEDBACK_ANSWERS = ['well', 'okay', 'not-for-me'] as const;

export type FeedbackAnswer = (typeof FEEDBACK_ANSWERS)[number];

/** The match to ask about: whose, and with whom. */
export interface FeedbackDue {
  matchId: string;
  partnerName: string;
}

export type FeedbackResult = { ok: true } | { ok: false; reason: 'not-found' | 'not-mutual' | 'invalid' };

const WEEK_MS = 7 * 24 * 60 * 60 * 1000;

/**
 * The match to ask this person about now, or null. Only ever their latest one
 * where both said hello, and only once it's in the past: a newer round they
 * were in is out, or a week has gone by. Not one that ended (a pass or a
 * report says enough), and not one they've already answered or skipped.
 */
export async function feedbackDue(prisma: PrismaClient, userId: string, options: { now?: Date } = {}): Promise<FeedbackDue | null> {
  const now = options.now ?? new Date();
  const profile = await prisma.profile.findUnique({ where: { userId }, select: { id: true } });
  if (profile === null) return null;

  const latestRound = await prisma.matchRoundParticipant.findFirst({
    where: { profileId: profile.id, round: { status: 'PUBLISHED' } },
    orderBy: { round: { startedAt: 'desc' } },
    select: { roundId: true },
  });
  const mutual = await prisma.match.findMany({
    where: {
      OR: [{ profileAId: profile.id }, { profileBId: profile.id }],
      round: { status: 'PUBLISHED' },
      helloAAt: { not: null },
      helloBAt: { not: null },
    },
    orderBy: { round: { startedAt: 'desc' } },
    take: 2,
    select: {
      id: true,
      roundId: true,
      profileAId: true,
      profileBId: true,
      round: { select: { startedAt: true, completedAt: true } },
      profileA: { select: { displayName: true } },
      profileB: { select: { displayName: true } },
      feedback: { where: { profileId: profile.id }, select: { answer: true } },
    },
  });

  const past = mutual.find(
    (match) => match.roundId !== latestRound?.roundId || now.getTime() - (match.round.completedAt ?? match.round.startedAt).getTime() >= WEEK_MS,
  );
  if (past === undefined || past.feedback.length > 0) return null;

  const ended = await prisma.profileBlock.findFirst({
    where: {
      OR: [
        { blockerId: past.profileAId, blockedId: past.profileBId },
        { blockerId: past.profileBId, blockedId: past.profileAId },
      ],
    },
    select: { blockerId: true },
  });
  if (ended !== null) return null;
  return { matchId: past.id, partnerName: past.profileAId === profile.id ? past.profileB.displayName : past.profileA.displayName };
}

/** Record how the match went (null: they'd rather not say). They can change it later. */
export async function giveFeedback(prisma: PrismaClient, userId: string, matchId: string, answer: FeedbackAnswer | null): Promise<FeedbackResult> {
  if (answer !== null && !FEEDBACK_ANSWERS.includes(answer)) return { ok: false, reason: 'invalid' };
  const found = await findOwnMatch(prisma, userId, matchId);
  if (found === null) return { ok: false, reason: 'not-found' };
  if (!found.mutual) return { ok: false, reason: 'not-mutual' };
  await prisma.matchFeedback.upsert({
    where: { matchId_profileId: { matchId, profileId: found.profileId } },
    create: { matchId, profileId: found.profileId, answer },
    update: { answer, createdAt: new Date() },
  });
  return { ok: true };
}
