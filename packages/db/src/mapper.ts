/**
 * Bridge from stored rows to the matching engine.
 *
 * `@hated/core` consumes a plain `Profile`, but persistence splits it across
 * several tables: trait/desire key-value rows, a seeking join table, and blocks
 * stored one-directionally. This module flattens a `Profile` query (with the
 * relations in `PROFILE_INCLUDE`) into the engine's shape.
 *
 * The import from `@hated/core` is type-only, so this file carries no runtime
 * dependency on the engine.
 */

import type { PreferenceWeights, Profile as EngineProfile, TargetedTrait } from '@hated/core';

import type { Prisma } from './generated/prisma/client.js';

/**
 * Relations the mapper reads. Spread into a `prisma.profile.*` call's `include`
 * (or use `PROFILE_INCLUDE`) so the query loads exactly what is needed.
 */
export const PROFILE_INCLUDE = {
  seeking: true,
  traits: true,
  desires: true,
  blocksMade: true,
  blocksTargetingMe: true,
} satisfies Prisma.ProfileInclude;

/** The payload produced by `prisma.profile.find...({ include: PROFILE_INCLUDE })`. */
export type ProfileRow = Prisma.ProfileGetPayload<{ include: typeof PROFILE_INCLUDE }>;

/**
 * Compile-time guard: a real Prisma payload must be accepted by the mapper.
 * If the schema or `PROFILE_INCLUDE` drifts, `Assert<false>` fails to compile.
 */
type Assert<T extends true> = T;
export type ProfileRowMatchesMapperInput = Assert<
  ProfileRow extends ProfileWithRelations ? true : false
>;

/**
 * Structural view of the row the mapper actually consumes.
 *
 * This is deliberately narrower than `ProfileRow` (which also carries
 * `displayName`, `birthDate`, timestamps, ...). Prisma rows are assignable to
 * it structurally, which keeps the mapper easy to unit test without a database.
 */
export interface ProfileWithRelations {
  id: string;
  genderId: string;
  /** Per-person ranking weights; treated as a unit, see `toEngineProfile`. */
  similarityWeight: number | null;
  desireWeight: number | null;
  reciprocityWeight: number | null;
  seeking: readonly { genderId: string }[];
  traits: readonly { key: string; value: number }[];
  desires: readonly { key: string; target: number; weight: number }[];
  /** Blocks this profile created. */
  blocksMade: readonly { blockedId: string }[];
  /** Blocks other profiles created against this one. */
  blocksTargetingMe: readonly { blockerId: string }[];
}

/**
 * Flatten one stored profile into the engine's `Profile`.
 *
 * Contract details that matter downstream:
 *
 * - **Blocks are symmetric.** The engine only checks "is either side blocking
 *   the other", so the mapper unions the blocks this profile made with the ones
 *   aimed at it. Storing a block once is enough; both people become mutually
 *   unacceptable.
 * - **Weights are all-or-nothing.** The three weight columns are read as a
 *   unit: `weights` is emitted only when all three are non-null. Otherwise the
 *   profile is left without weights and the round's `FirstDateConfig` defaults
 *   apply, which is exactly what `resolveWeights` expects.
 * - **Empty `seeking` means "open to everyone".** No rows in the join table
 *   maps straight to an empty array, matching `isOpenTo`.
 */
export function toEngineProfile(row: ProfileWithRelations): EngineProfile {
  const traits: Record<string, number> = {};
  for (const trait of row.traits) traits[trait.key] = trait.value;

  const desired: Record<string, TargetedTrait> = {};
  for (const desire of row.desires) {
    desired[desire.key] = { target: desire.target, weight: desire.weight };
  }

  const blocked = collectBlockedIds(row);

  const profile: EngineProfile = {
    id: row.id,
    gender: row.genderId,
    seeking: row.seeking.map((entry) => entry.genderId),
    traits,
    desired,
  };

  const weights = resolveWeights(row);
  if (weights !== undefined) profile.weights = weights;

  if (blocked.length > 0) profile.blocked = blocked;

  return profile;
}

/** Convenience for a whole population; order is preserved. */
export function toEngineProfiles(rows: readonly ProfileWithRelations[]): EngineProfile[] {
  return rows.map(toEngineProfile);
}

/**
 * The set of profiles this one cannot be matched with, sorted for determinism.
 * Both directions of a block count, since the engine treats blocks as symmetric.
 */
function collectBlockedIds(row: ProfileWithRelations): string[] {
  const blocked = new Set<string>();
  for (const block of row.blocksMade) blocked.add(block.blockedId);
  for (const block of row.blocksTargetingMe) blocked.add(block.blockerId);
  return [...blocked].sort();
}

/** Build `PreferenceWeights` only when every weight column is set. */
function resolveWeights(row: ProfileWithRelations): PreferenceWeights | undefined {
  const { similarityWeight, desireWeight, reciprocityWeight } = row;
  if (similarityWeight === null || desireWeight === null || reciprocityWeight === null) {
    return undefined;
  }
  return { similarityWeight, desireWeight, reciprocityWeight };
}
