/**
 * Load a population for a match round.
 *
 * This is the one call a worker needs before running the engine:
 *
 *   const population = await loadEngineProfiles(prisma);
 *   const round = runMatchRound(population, { objective: 'egalitarian' });
 *
 * Results are ordered by id so the same database state always feeds the engine
 * in the same order, which is what makes a round reproducible after the fact.
 */

import type { Profile } from '@hated/core';

import type { PrismaClient } from './generated/prisma/client.js';
import { PROFILE_INCLUDE, toEngineProfiles } from './mapper.js';

export interface LoadPopulationOptions {
  /** Restrict to these profile ids, e.g. a precomputed cohort. */
  ids?: readonly string[];
  /** Include profiles with `isActive = false`. Default false (active only). */
  includeInactive?: boolean;
}

/**
 * Fetch profiles with the relations the mapper reads and flatten them into the
 * engine's `Profile` shape.
 */
export async function loadEngineProfiles(
  prisma: PrismaClient,
  options: LoadPopulationOptions = {},
): Promise<Profile[]> {
  const rows = await prisma.profile.findMany({
    where: {
      ...(options.includeInactive === true ? {} : { isActive: true }),
      ...(options.ids === undefined ? {} : { id: { in: [...options.ids] } }),
    },
    include: PROFILE_INCLUDE,
    orderBy: { id: 'asc' },
  });

  return toEngineProfiles(rows);
}
