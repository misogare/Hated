/**
 * Persist a completed match round.
 *
 * `runMatchRound` returns a rich result; this writes the parts a product needs to
 * keep. It runs in a single transaction so a round never lands half-written:
 * either the round, its participants, and its matches are all stored, or none
 * are.
 *
 * What gets recorded:
 * - `MatchRound`          objective, config, seed, population/matched/matchRate,
 *                         the metrics plus a compact fairness summary
 * - `MatchRoundParticipant` everyone who entered, with their side and whether
 *                         they matched (and, if not, a coarse reason)
 * - `Match`               one row per pair, with each side's 1-based rank and,
 *                         when the population is supplied, the directional
 *                         scores
 */

import {
  scoreTowards,
  type Profile,
  type RoundResult,
} from '@hated/core';

import type { MatchRoundStatus } from './generated/prisma/enums.js';
import type { Prisma, PrismaClient } from './generated/prisma/client.js';

export interface PersistMatchRoundOptions {
  /** Round status to store. Default `COMPUTED`. */
  status?: MatchRoundStatus;
  /** RNG seed the round ran with, if any. */
  seed?: number;
  /**
   * The population the round ran on. When supplied, each pair also gets the two
   * directional scores (`scoreTowards`); otherwise those columns stay null.
   */
  population?: readonly Profile[];
  startedAt?: Date;
  completedAt?: Date;
  /** The weekly slot this round ran for, when the scheduler ran it. */
  scheduledFor?: Date;
}

export interface PersistedMatchRound {
  roundId: string;
  participants: number;
  matches: number;
}

interface ParticipantRow {
  profileId: string;
  side: 'A' | 'B';
  matched: boolean;
  unmatchedReason: string | null;
}

interface MatchRow {
  profileAId: string;
  profileBId: string;
  rankA: number | null;
  rankB: number | null;
  scoreAB: number | null;
  scoreBA: number | null;
}

export async function persistMatchRound(
  prisma: PrismaClient,
  result: RoundResult,
  options: PersistMatchRoundOptions = {},
): Promise<PersistedMatchRound> {
  const completedAt = options.completedAt ?? new Date();
  const startedAt = options.startedAt ?? completedAt;
  const profilesById =
    options.population === undefined
      ? null
      : new Map(options.population.map((profile) => [profile.id, profile]));

  const participants = buildParticipants(result);
  const matches = buildMatches(result, profilesById);

  return prisma.$transaction(async (tx) => {
    const round = await tx.matchRound.create({
      data: {
        status: options.status ?? 'COMPUTED',
        objective: result.objective,
        config: toJson(result.config),
        seed: options.seed ?? null,
        population: result.metrics.population,
        matched: result.metrics.matched,
        matchRate: result.metrics.matchRate,
        stable: result.metrics.stable,
        metrics: toJson(buildMetrics(result)),
        startedAt,
        completedAt,
        scheduledFor: options.scheduledFor ?? null,
      },
      select: { id: true },
    });

    if (participants.length > 0) {
      await tx.matchRoundParticipant.createMany({
        data: participants.map((participant) => ({ ...participant, roundId: round.id })),
      });
    }

    if (matches.length > 0) {
      await tx.match.createMany({
        data: matches.map((match) => ({ ...match, roundId: round.id })),
      });
    }

    return { roundId: round.id, participants: participants.length, matches: matches.length };
  });
}

/** One participant per person, split by the partition, flagged matched or not. */
function buildParticipants(result: RoundResult): ParticipantRow[] {
  const rows: ParticipantRow[] = [];
  appendSide(rows, result, result.partition.sideA, 'A', result.proposerPrefs);
  appendSide(rows, result, result.partition.sideB, 'B', result.receiverPrefs);
  return rows;
}

function appendSide(
  rows: ParticipantRow[],
  result: RoundResult,
  ids: readonly string[],
  side: 'A' | 'B',
  prefs: ReadonlyMap<string, readonly string[]>,
): void {
  for (const id of ids) {
    const matched = result.partners.has(id);
    rows.push({
      profileId: id,
      side,
      matched,
      // Coarse but deterministic: an empty list means nobody was even eligible,
      // anything else means they were eligible and lost.
      unmatchedReason: matched
        ? null
        : (prefs.get(id)?.length ?? 0) === 0
          ? 'no-eligible-candidates'
          : 'not-selected',
    });
  }
}

/** One row per pair, with 1-based ranks and (optionally) directional scores. */
function buildMatches(
  result: RoundResult,
  profilesById: ReadonlyMap<string, Profile> | null,
): MatchRow[] {
  return result.pairs.map(({ a, b }) => {
    const rankA = (result.proposerPrefs.get(a) ?? []).indexOf(b);
    const rankB = (result.receiverPrefs.get(b) ?? []).indexOf(a);

    let scoreAB: number | null = null;
    let scoreBA: number | null = null;
    if (profilesById !== null) {
      const profileA = profilesById.get(a);
      const profileB = profilesById.get(b);
      if (profileA !== undefined && profileB !== undefined) {
        scoreAB = scoreTowards(profileA, profileB, result.config);
        scoreBA = scoreTowards(profileB, profileA, result.config);
      }
    }

    return {
      profileAId: a,
      profileBId: b,
      rankA: rankA >= 0 ? rankA + 1 : null,
      rankB: rankB >= 0 ? rankB + 1 : null,
      scoreAB,
      scoreBA,
    };
  });
}

/** Round metrics plus a compact fairness summary, for auditing why a round shipped. */
function buildMetrics(result: RoundResult): Record<string, unknown> {
  return {
    ...result.metrics,
    fair: {
      objective: result.fair.objective,
      objectiveValue: result.fair.objectiveValue,
      proposerOptimalValue: result.fair.proposerOptimalValue,
      receiverOptimalValue: result.fair.receiverOptimalValue,
      improvement: result.fair.improvement,
      strategy: result.fair.strategy,
      rotationsApplied: result.fair.rotationsApplied,
      exhaustiveComplete: result.fair.exhaustiveComplete,
    },
  };
}

function toJson(value: unknown): Prisma.InputJsonValue {
  return value as Prisma.InputJsonValue;
}
