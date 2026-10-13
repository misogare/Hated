/**
 * What a person sees after a round: their match (or that there was none), why
 * the two of them fit, and the two things they can do about it.
 *
 * Only PUBLISHED rounds are visible. A round persisted as COMPUTED can be
 * inspected and compared by operators first; publishing it is the release.
 *
 * Saying hello is recorded per side, and a conversation opens only when both
 * have. Whether the other person has said hello is not revealed on its own,
 * only as `mutual`, so nobody learns they were waved at and left on read.
 * Passing blocks the pair, so they are never matched again.
 *
 * Before both have said hello, a match reads the other person's words, the
 * highlights from their answers and blurred photos; after, the photos unlock.
 */

import { suggestOpeners } from './descriptions.js';
import type { PrismaClient } from './generated/prisma/client.js';
import type { PhotoView } from './photos.js';
import { profileCard } from './profile-card.js';
import type { PromptAnswer } from './profile-words.js';
import { ageOn } from './profiles.js';
import { countUnread } from './unread.js';

export interface MatchView {
  matchId: string;
  partner: {
    displayName: string;
    age: number;
    /** Where their email was verified, e.g. "Victoria University". */
    institution: string | null;
    bio: string | null;
    prompts: PromptAnswer[];
    /** Worked out from their questionnaire, e.g. "Humor comes first". */
    highlights: string[];
    /** Main first. None once the match has ended. */
    photos: PhotoView[];
  };
  /** Both have said hello (and neither has passed), so the photos can be seen in full. */
  photosUnlocked: boolean;
  /** Short, plain reasons the two of them fit. May be empty. */
  reasons: string[];
  /** Ways to start the conversation, from the partner's prompts and what the two share. */
  openers: string[];
  saidHello: boolean;
  /** Both have said hello. */
  mutual: boolean;
  passed: boolean;
  /** Messages from the partner not yet read. */
  unread: number;
}

/** One match, wherever it is in the person's history. */
export interface MatchDetail {
  roundId: string;
  publishedAt: string;
  match: MatchView;
}

export type RoundResultView =
  | { status: 'none' }
  | { status: 'matched'; roundId: string; publishedAt: string; match: MatchView }
  | { status: 'unmatched'; roundId: string; publishedAt: string; reason: string | null };

export type MatchActionResult =
  | {
      ok: true;
      mutual: boolean;
      /** This call's hello is the one that made it mutual (for notifying once). */
      becameMutual?: boolean;
    }
  | { ok: false; reason: 'not-found' | 'passed' };

/** A trait's value or a desire, as the explanation needs them. */
export interface TraitSnapshot {
  traits: Readonly<Record<string, number>>;
  desires: Readonly<Record<string, { target: number; weight: number }>>;
}

/** Two values this close count as "the same" for an explanation. */
const CLOSE = 0.15;
const MAX_REASONS = 3;

/**
 * Plain phrases per trait key. `alike` is indexed by how high the pair sits
 * (low, middle, high); `hoped` is used when the partner matches a desire.
 * A trait with no entry here is simply never mentioned.
 */
const TRAIT_COPY: Record<string, { alike: [string, string, string]; hoped: string }> = {
  values: {
    alike: [
      "Neither of you needs values to line up perfectly",
      'Shared values matter to you both, within reason',
      'Shared values shape both your lives',
    ],
    hoped: 'They care about values the way you hoped',
  },
  lifestyle: {
    alike: ["You're both happiest at home", 'You both like a mix of nights in and out', "You're both always up for going out"],
    hoped: 'Their social energy is what you hoped for',
  },
  ambition: {
    alike: ['You both keep work in its place', "You're both driven, with balance", "You're both all in on your work"],
    hoped: 'Just as driven as you hoped',
  },
  humor: {
    alike: ["You're both more earnest than jokey", 'You both know when a joke fits', 'You both lead with humor'],
    hoped: 'Their humor is what you hoped for',
  },
  openness: {
    alike: ['You both love what you know', "You're both open, at your own pace", 'You both say yes to new things'],
    hoped: 'Just as open as you hoped',
  },
};

/**
 * Why the viewer and their partner fit, strongest first: desires the partner
 * meets (weighted by how much they matter), then traits they share.
 */
export function explainMatch(viewer: TraitSnapshot, partner: TraitSnapshot): string[] {
  const candidates: Array<{ text: string; strength: number }> = [];

  for (const [key, desire] of Object.entries(viewer.desires)) {
    const copy = TRAIT_COPY[key];
    const value = partner.traits[key];
    if (copy === undefined || value === undefined || desire.weight <= 0) continue;
    const gap = Math.abs(value - desire.target);
    // A met desire outranks a mere similarity: offset by 1.
    if (gap <= CLOSE) candidates.push({ text: copy.hoped, strength: 1 + desire.weight * (1 - gap) });
  }

  const mentioned = new Set(candidates.map(({ text }) => text));
  for (const [key, mine] of Object.entries(viewer.traits)) {
    const copy = TRAIT_COPY[key];
    const theirs = partner.traits[key];
    if (copy === undefined || theirs === undefined) continue;
    const gap = Math.abs(mine - theirs);
    // One reason per trait: a met desire already speaks for it.
    if (gap > CLOSE || mentioned.has(copy.hoped)) continue;
    const level = (mine + theirs) / 2;
    candidates.push({ text: copy.alike[level < 1 / 3 ? 0 : level < 2 / 3 ? 1 : 2], strength: 1 - gap });
  }

  return candidates
    .sort((a, b) => b.strength - a.strength)
    .slice(0, MAX_REASONS)
    .map(({ text }) => text);
}

/** The person's result from the most recent published round they were in. */
export async function getLatestResult(
  prisma: PrismaClient,
  userId: string,
  options: { now?: Date } = {},
): Promise<RoundResultView> {
  const profile = await prisma.profile.findUnique({
    where: { userId },
    select: { id: true, traits: true, desires: true },
  });
  if (profile === null) return { status: 'none' };

  const entry = await prisma.matchRoundParticipant.findFirst({
    where: { profileId: profile.id, round: { status: 'PUBLISHED' } },
    orderBy: { round: { startedAt: 'desc' } },
    include: { round: { select: { id: true, startedAt: true, completedAt: true } } },
  });
  if (entry === null) return { status: 'none' };

  const roundId = entry.round.id;
  const publishedAt = (entry.round.completedAt ?? entry.round.startedAt).toISOString();
  if (!entry.matched) return { status: 'unmatched', roundId, publishedAt, reason: entry.unmatchedReason };

  const match = await prisma.match.findFirst({
    where: { roundId, OR: [{ profileAId: profile.id }, { profileBId: profile.id }] },
  });
  // Matched, but the match is gone: the other person deleted their account.
  // Show nothing rather than a "no match" that never happened.
  if (match === null) return { status: 'none' };

  return { status: 'matched', roundId, publishedAt, match: await viewMatch(prisma, profile, match, options.now ?? new Date()) };
}

/** One of the person's matches from any published round, or null if it isn't theirs. */
export async function getMatch(
  prisma: PrismaClient,
  userId: string,
  matchId: string,
  options: { now?: Date } = {},
): Promise<MatchDetail | null> {
  const profile = await prisma.profile.findUnique({
    where: { userId },
    select: { id: true, traits: true, desires: true },
  });
  if (profile === null) return null;

  const match = await prisma.match.findFirst({
    where: { id: matchId, round: { status: 'PUBLISHED' }, OR: [{ profileAId: profile.id }, { profileBId: profile.id }] },
    include: { round: { select: { startedAt: true, completedAt: true } } },
  });
  if (match === null) return null;
  return {
    roundId: match.roundId,
    publishedAt: (match.round.completedAt ?? match.round.startedAt).toISOString(),
    match: await viewMatch(prisma, profile, match, options.now ?? new Date()),
  };
}

/** A match from the viewer's side. */
async function viewMatch(
  prisma: PrismaClient,
  viewer: { id: string; traits: Array<{ key: string; value: number }>; desires: Array<{ key: string; target: number; weight: number }> },
  match: {
    id: string;
    profileAId: string;
    profileBId: string;
    helloAAt: Date | null;
    helloBAt: Date | null;
    readAAt: Date | null;
    readBAt: Date | null;
  },
  now: Date,
): Promise<MatchView> {
  const isA = match.profileAId === viewer.id;
  const partnerId = isA ? match.profileBId : match.profileAId;
  const [partner, card, block] = await Promise.all([
    prisma.profile.findUniqueOrThrow({
      where: { id: partnerId },
      select: {
        displayName: true,
        birthDate: true,
        user: {
          select: {
            verifications: {
              where: { status: 'VERIFIED' },
              orderBy: { verifiedAt: 'desc' },
              take: 1,
              select: { institution: { select: { name: true } } },
            },
          },
        },
      },
    }),
    profileCard(prisma, partnerId),
    prisma.profileBlock.findFirst({
      where: {
        OR: [
          { blockerId: viewer.id, blockedId: partnerId },
          { blockerId: partnerId, blockedId: viewer.id },
        ],
      },
      select: { blockerId: true },
    }),
  ]);

  const mine = isA ? match.helloAAt : match.helloBAt;
  const theirs = isA ? match.helloBAt : match.helloAAt;
  const mutual = mine !== null && theirs !== null;
  const passed = block !== null;
  const own = snapshot(viewer);
  return {
    matchId: match.id,
    partner: {
      displayName: partner.displayName,
      age: ageOn(partner.birthDate, now),
      institution: partner.user.verifications[0]?.institution?.name ?? null,
      bio: card.bio,
      prompts: card.prompts,
      highlights: card.highlights,
      // An ended match shows no photos at all, not even blurred ones.
      photos: passed ? [] : card.photos,
    },
    photosUnlocked: mutual && !passed,
    reasons: explainMatch(own, { traits: card.traits, desires: {} }),
    openers: suggestOpeners(card.prompts, own.traits, card.traits),
    saidHello: mine !== null,
    mutual,
    passed,
    unread: await countUnread(prisma, match.id, partnerId, isA ? match.readAAt : match.readBAt),
  };
}

/** Record the person's hello on a match they are part of. Idempotent. */
export async function sayHello(
  prisma: PrismaClient,
  userId: string,
  matchId: string,
  options: { now?: Date } = {},
): Promise<MatchActionResult> {
  const found = await findOwnMatch(prisma, userId, matchId);
  if (found === null) return { ok: false, reason: 'not-found' };
  if (found.passed) return { ok: false, reason: 'passed' };

  const now = options.now ?? new Date();
  // Only the first hello counts: the null guard keeps the original time.
  const { count } = found.isA
    ? await prisma.match.updateMany({ where: { id: matchId, helloAAt: null }, data: { helloAAt: now } })
    : await prisma.match.updateMany({ where: { id: matchId, helloBAt: null }, data: { helloBAt: now } });
  const updated = await prisma.match.findUniqueOrThrow({ where: { id: matchId }, select: { helloAAt: true, helloBAt: true } });
  const mutual = updated.helloAAt !== null && updated.helloBAt !== null;
  return { ok: true, mutual, becameMutual: count > 0 && mutual };
}

/** Pass on a match: block the pair so they are never matched again. Idempotent. */
export async function passMatch(prisma: PrismaClient, userId: string, matchId: string): Promise<MatchActionResult> {
  const found = await findOwnMatch(prisma, userId, matchId);
  if (found === null) return { ok: false, reason: 'not-found' };

  await prisma.profileBlock.upsert({
    where: { blockerId_blockedId: { blockerId: found.profileId, blockedId: found.partnerId } },
    create: { blockerId: found.profileId, blockedId: found.partnerId, reason: 'passed-match' },
    update: {},
  });
  return { ok: true, mutual: false };
}

/**
 * The match if this person is on it and its round is published. Anything else
 * reads as not found, so ids of other people's matches reveal nothing.
 * Shared with the chat, which also needs `mutual`.
 */
export async function findOwnMatch(prisma: PrismaClient, userId: string, matchId: string) {
  const profile = await prisma.profile.findUnique({ where: { userId }, select: { id: true } });
  if (profile === null) return null;
  const match = await prisma.match.findFirst({
    where: {
      id: matchId,
      round: { status: 'PUBLISHED' },
      OR: [{ profileAId: profile.id }, { profileBId: profile.id }],
    },
    select: { profileAId: true, profileBId: true, helloAAt: true, helloBAt: true },
  });
  if (match === null) return null;

  const isA = match.profileAId === profile.id;
  const partnerId = isA ? match.profileBId : match.profileAId;
  const block = await prisma.profileBlock.findFirst({
    where: {
      OR: [
        { blockerId: profile.id, blockedId: partnerId },
        { blockerId: partnerId, blockedId: profile.id },
      ],
    },
    select: { blockerId: true },
  });
  return {
    profileId: profile.id,
    partnerId,
    isA,
    passed: block !== null,
    mutual: match.helloAAt !== null && match.helloBAt !== null,
  };
}

function snapshot(profile: {
  traits: Array<{ key: string; value: number }>;
  desires: Array<{ key: string; target: number; weight: number }>;
}): TraitSnapshot {
  return {
    traits: Object.fromEntries(profile.traits.map((trait) => [trait.key, trait.value])),
    desires: Object.fromEntries(
      profile.desires.map((desire) => [desire.key, { target: desire.target, weight: desire.weight }]),
    ),
  };
}
