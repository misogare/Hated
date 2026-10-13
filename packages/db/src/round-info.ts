/**
 * Read a persisted round back.
 *
 * `persistMatchRound` writes a round in one transaction; this is its inverse. It
 * returns everything needed to answer "what did that round actually do": the
 * round header and stored metrics, every participant with their side and outcome
 * (including why the unmatched went unmatched), and every pair with each side's
 * rank and directional score.
 *
 * Kept separate from the CLI so an API route can reuse it: `getRoundReport`
 * takes a client and an id and returns a plain object (or `null` when the id is
 * unknown), with no printing or process concerns.
 */

import type { PrismaClient } from './generated/prisma/client.js';
import type { Side } from './generated/prisma/enums.js';

/** The subset of `RoundMetrics` + fairness summary persisted in `metrics`. */
export interface StoredMetrics {
  population?: number;
  matched?: number;
  matchRate?: number;
  matchablePairs?: number;
  wastedPairs?: number;
  totalCompatiblePairs?: number;
  firstChoiceRate?: number;
  worstCost?: number;
  satisfactionGap?: number;
  stable?: boolean;
  sideA?: { meanCost?: number; firstChoiceRate?: number };
  sideB?: { meanCost?: number; firstChoiceRate?: number };
  fair?: {
    objective?: string;
    strategy?: string;
    objectiveValue?: number;
    improvement?: number;
    rotationsApplied?: number;
    exhaustiveComplete?: boolean;
  };
}

export interface RoundReportParticipant {
  profileId: string;
  displayName: string;
  side: Side;
  matched: boolean;
  unmatchedReason: string | null;
}

export interface RoundReportMatch {
  profileAId: string;
  displayNameA: string;
  profileBId: string;
  displayNameB: string;
  /** 1-based rank of the other within each side's preference list. */
  rankA: number | null;
  rankB: number | null;
  scoreAB: number | null;
  scoreBA: number | null;
}

export interface RoundReport {
  id: string;
  status: string;
  objective: string;
  config: unknown;
  seed: number | null;
  population: number;
  matched: number;
  matchRate: number;
  stable: boolean;
  metrics: StoredMetrics | null;
  startedAt: Date;
  completedAt: Date | null;
  participants: RoundReportParticipant[];
  matches: RoundReportMatch[];
  /** How the round's matches went, from everyone's answers (see feedback.ts). */
  feedback: { well: number; okay: number; notForMe: number; skipped: number };
}

/** A published round in brief, newest first: its size and how its matches went. */
export interface RoundSummary {
  id: string;
  publishedAt: string;
  population: number;
  matched: number;
  feedback: RoundReport['feedback'];
}

/** How a round's matches went, counted from everyone's answers (null: rather not say). */
function tally(answers: ReadonlyArray<string | null>): RoundReport['feedback'] {
  const count = (answer: string | null) => answers.filter((given) => given === answer).length;
  return { well: count('well'), okay: count('okay'), notForMe: count('not-for-me'), skipped: count(null) };
}

/** The latest published rounds, newest first. */
export async function listRecentRounds(prisma: PrismaClient, options: { limit?: number } = {}): Promise<RoundSummary[]> {
  const rounds = await prisma.matchRound.findMany({
    where: { status: 'PUBLISHED' },
    orderBy: { startedAt: 'desc' },
    take: options.limit ?? 8,
    select: {
      id: true,
      startedAt: true,
      completedAt: true,
      population: true,
      matched: true,
      matches: { select: { feedback: { select: { answer: true } } } },
    },
  });
  return rounds.map((round) => ({
    id: round.id,
    publishedAt: (round.completedAt ?? round.startedAt).toISOString(),
    population: round.population,
    matched: round.matched,
    feedback: tally(round.matches.flatMap((match) => match.feedback.map((feedback) => feedback.answer))),
  }));
}

/** Load a round report, or `null` if no round has that id. */
export async function getRoundReport(
  prisma: PrismaClient,
  roundId: string,
): Promise<RoundReport | null> {
  const round = await prisma.matchRound.findUnique({
    where: { id: roundId },
    include: {
      participants: {
        include: { profile: { select: { displayName: true } } },
        orderBy: [{ side: 'asc' }, { profileId: 'asc' }],
      },
      matches: {
        include: {
          profileA: { select: { displayName: true } },
          profileB: { select: { displayName: true } },
          feedback: { select: { answer: true } },
        },
        orderBy: { profileAId: 'asc' },
      },
    },
  });

  if (round === null) return null;

  return {
    id: round.id,
    status: round.status,
    objective: round.objective,
    config: round.config,
    seed: round.seed,
    population: round.population,
    matched: round.matched,
    matchRate: round.matchRate,
    stable: round.stable,
    metrics: (round.metrics as StoredMetrics | null) ?? null,
    startedAt: round.startedAt,
    completedAt: round.completedAt,
    participants: round.participants.map((participant) => ({
      profileId: participant.profileId,
      displayName: participant.profile.displayName,
      side: participant.side,
      matched: participant.matched,
      unmatchedReason: participant.unmatchedReason,
    })),
    matches: round.matches.map((match) => ({
      profileAId: match.profileAId,
      displayNameA: match.profileA.displayName,
      profileBId: match.profileBId,
      displayNameB: match.profileB.displayName,
      rankA: match.rankA,
      rankB: match.rankB,
      scoreAB: match.scoreAB,
      scoreBA: match.scoreBA,
    })),
    feedback: tally(round.matches.flatMap((match) => match.feedback.map((feedback) => feedback.answer))),
  };
}
