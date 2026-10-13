/** Builders for integration tests: people and rounds as the app would create them. */

import type { PrismaClient } from '../../src/generated/prisma/client.js';
import { saveProfile } from '../../src/profiles.js';
import { sayHello } from '../../src/results.js';

export const NOW = new Date('2026-10-05T12:00:00Z');

/** A verified account at Victoria University (seeded) with a profile. */
export async function member(
  prisma: PrismaClient,
  email: string,
  displayName: string,
  gender: string,
  seeking: string[],
): Promise<{ userId: string; profileId: string }> {
  const user = await prisma.user.create({ data: { email, emailVerified: true } });
  const institution = await prisma.institution.findUniqueOrThrow({ where: { domain: 'vu.edu.au' } });
  await prisma.institutionVerification.create({
    data: {
      userId: user.id,
      email,
      domain: 'vu.edu.au',
      type: 'EDU',
      status: 'VERIFIED',
      codeHash: 'x',
      expiresAt: NOW,
      verifiedAt: NOW,
      institutionId: institution.id,
    },
  });
  const saved = await saveProfile(
    prisma,
    user.id,
    { displayName, birthDate: new Date('2003-04-20'), gender, seeking },
    { now: NOW },
  );
  if (!saved.ok) throw new Error(saved.problems.join(' '));
  return { userId: user.id, profileId: saved.profileId };
}

/**
 * A two-person round that matched `a` with `b`, published now (so the window
 * to say hello is open) unless told when.
 */
export async function roundMatching(
  prisma: PrismaClient,
  a: string,
  b: string,
  status: 'PUBLISHED' | 'COMPUTED' = 'PUBLISHED',
  publishedAt: Date = new Date(),
) {
  const round = await prisma.matchRound.create({
    data: { status, objective: 'min-regret', config: {}, population: 2, matched: 2, matchRate: 1, stable: true, startedAt: publishedAt, completedAt: publishedAt },
  });
  await prisma.matchRoundParticipant.createMany({
    data: [
      { roundId: round.id, profileId: a, side: 'A', matched: true },
      { roundId: round.id, profileId: b, side: 'B', matched: true },
    ],
  });
  return prisma.match.create({ data: { roundId: round.id, profileAId: a, profileBId: b } });
}

/** Say hello a minute after the match's round was published, well inside the window, however old the round. */
export async function helloInTime(prisma: PrismaClient, userId: string, matchId: string) {
  const { round } = await prisma.match.findUniqueOrThrow({ where: { id: matchId }, select: { round: { select: { startedAt: true, completedAt: true } } } });
  return sayHello(prisma, userId, matchId, { now: new Date((round.completedAt ?? round.startedAt).getTime() + 60_000) });
}
