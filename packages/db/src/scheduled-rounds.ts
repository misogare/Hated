/**
 * Running the round for a weekly slot, safely from any number of servers.
 *
 * The round row stores the slot in a unique `scheduledFor` column, so a slot
 * can only ever be run once: a second server (or a restart that catches up a
 * missed slot) either sees the existing round or loses the insert race, and
 * reports `already-ran` instead of matching people twice.
 */

import { runMatchRound, type FairObjective } from '@hated/core';

import type { PrismaClient } from './generated/prisma/client.js';
import { loadEngineProfiles } from './population.js';
import { persistMatchRound } from './rounds.js';

export interface ScheduledRoundOptions {
  /** Which stable matching to ship. Default min-regret, as for hand-run rounds. */
  objective?: FairObjective;
  /** RNG seed for the fairness search. Default 42, as for hand-run rounds. */
  seed?: number;
}

export type ScheduledRoundResult =
  | { ran: true; roundId: string; population: number; matched: number }
  | { ran: false; reason: 'already-ran' | 'nobody-active' };

export async function runScheduledRound(
  prisma: PrismaClient,
  slot: Date,
  options: ScheduledRoundOptions = {},
): Promise<ScheduledRoundResult> {
  const existing = await prisma.matchRound.findUnique({ where: { scheduledFor: slot }, select: { id: true } });
  if (existing !== null) return { ran: false, reason: 'already-ran' };

  const population = await loadEngineProfiles(prisma);
  if (population.length === 0) return { ran: false, reason: 'nobody-active' };

  const seed = options.seed ?? 42;
  const result = runMatchRound(population, { objective: options.objective ?? 'min-regret', seed });
  try {
    const persisted = await persistMatchRound(prisma, result, {
      status: 'PUBLISHED',
      seed,
      population,
      scheduledFor: slot,
    });
    return { ran: true, roundId: persisted.roundId, population: population.length, matched: result.metrics.matched };
  } catch (error) {
    // Another server inserted this slot between our check and our insert.
    if ((error as { code?: unknown }).code === 'P2002') return { ran: false, reason: 'already-ran' };
    throw error;
  }
}
