/**
 * Synthetic populations for simulation.
 *
 * The point of simulating is to expose failure modes that a two-user unit test
 * cannot: gendered imbalance, orientation mix, and cliquish trait clusters that
 * make the preference graph sparse and unevenly distributed.
 *
 * Traits are drawn from clusters on purpose. If every user's traits were
 * independent noise, everyone would be equally similar to everyone else and the
 * matching would be meaningless. Clusters create the realistic situation where
 * some people have hundreds of viable candidates and others have almost none.
 */

import type { GenderId, Profile, TargetedTrait } from '../types.js';
import { createRng, gaussian, type Rng } from '../util/random.js';

export type Orientation = 'straight' | 'gay' | 'bisexual';

export interface SyntheticOptions {
  population: number;
  seed: number;
  /** Share of the pool by gender. Values are normalised. */
  genderMix?: Record<GenderId, number>;
  /** Share of the pool by orientation. Values are normalised. */
  orientationMix?: Record<Orientation, number>;
  /** Number of trait clusters. More clusters means sparser compatibility. */
  clusterCount?: number;
  traitCount?: number;
  /** Fraction of users who block a couple of random others. */
  blockedRate?: number;
  /**
   * Give each person their own ranking weights. Default true: without it every
   * pair scores almost identically in both directions and the pool has a unique
   * stable matching, so the fairness search has nothing to choose between.
   */
  personalizeWeights?: boolean;
  /**
   * How widely per-person ranking weights vary, as a fraction of the default
   * spread. 0 makes everyone share the default weights (no personal weighting);
   * 1 is the full spread. More spread means more independent rankings, which is
   * what gives the stable-matching lattice its size.
   */
  weightSpread?: number;
}

const DEFAULT_GENDER_MIX: Record<GenderId, number> = {
  man: 0.47,
  woman: 0.47,
  nonbinary: 0.06,
};

const DEFAULT_ORIENTATION_MIX: Record<Orientation, number> = {
  straight: 0.78,
  gay: 0.12,
  bisexual: 0.1,
};

function clamp01(value: number): number {
  if (value < 0) return 0;
  if (value > 1) return 1;
  return value;
}

export function seekingFor(gender: GenderId, orientation: Orientation): GenderId[] {
  if (orientation === 'bisexual') return ['man', 'woman', 'nonbinary'];
  if (orientation === 'gay') {
    // Same-gender seeking. For non-binary users this means other non-binary users.
    return [gender];
  }
  // Straight. Non-binary is not the "opposite" of anything, so we treat a
  // straight non-binary user as open to both binary genders. Modelling choice,
  // not a claim about anyone's identity.
  if (gender === 'man') return ['woman'];
  if (gender === 'woman') return ['man'];
  return ['man', 'woman'];
}

function weightedPick<K extends string>(rng: Rng, weights: Record<K, number>): K {
  const entries = Object.entries(weights) as Array<[K, number]>;
  const total = entries.reduce((sum, [, weight]) => sum + Math.max(0, weight), 0);
  if (total <= 0) return entries[0]![0];
  let threshold = rng.next() * total;
  for (const [key, weight] of entries) {
    threshold -= Math.max(0, weight);
    if (threshold <= 0) return key;
  }
  return entries[entries.length - 1]![0];
}

export function generatePopulation(options: SyntheticOptions): Profile[] {
  const population = Math.max(0, Math.floor(options.population));
  const rng = createRng(options.seed);
  const genderMix = options.genderMix ?? DEFAULT_GENDER_MIX;
  const orientationMix = options.orientationMix ?? DEFAULT_ORIENTATION_MIX;
  const clusterCount = Math.max(1, options.clusterCount ?? 5);
  const traitCount = Math.max(1, options.traitCount ?? 6);
  const blockedRate = options.blockedRate ?? 0.02;
  const personalizeWeights = options.personalizeWeights ?? true;
  const weightSpread = Math.max(0, options.weightSpread ?? 1);

  const traitNames = Array.from({ length: traitCount }, (_, index) => `t${index}`);

  const clusters = Array.from({ length: clusterCount }, () =>
    traitNames.map(() => 0.15 + rng.next() * 0.7),
  );

  const profiles: Profile[] = [];
  for (let index = 0; index < population; index++) {
    const id = `u${index.toString().padStart(5, '0')}`;
    const gender = weightedPick(rng, genderMix);
    const orientation = weightedPick(rng, orientationMix);
    const cluster = clusters[rng.int(clusterCount)]!;

    const traits: Record<string, number> = {};
    traitNames.forEach((name, traitIndex) => {
      traits[name] = clamp01(cluster[traitIndex]! + gaussian(rng) * 0.12);
    });

    const desired: Record<string, TargetedTrait> = {};
    traitNames.forEach((name) => {
      if (rng.next() > 0.6) return; // this trait did not matter to them
      // Mostly assortative: people want someone like themselves, with noise.
      const target = clamp01(traits[name]! + gaussian(rng) * 0.18);
      desired[name] = { target, weight: 0.2 + rng.next() * 0.8 };
    });

    // Personal ranking weights. Reciprocity stays at zero: folding the other
    // person's desire into this person's ranking makes the two directions
    // mirror images and collapses the lattice.
    const weights = personalizeWeights
      ? {
          similarityWeight: 0.3 + (rng.next() - 0.5) * 0.3 * weightSpread,
          desireWeight: 0.5 + (rng.next() - 0.5) * 0.3 * weightSpread,
          reciprocityWeight: 0,
        }
      : undefined;

    profiles.push({
      id,
      gender,
      seeking: seekingFor(gender, orientation),
      traits,
      desired,
      ...(weights !== undefined ? { weights } : {}),
    });
  }

  if (blockedRate > 0 && population > 1) {
    for (const profile of profiles) {
      if (rng.next() >= blockedRate) continue;
      const blockCount = 1 + rng.int(3);
      const blocked = new Set<string>();
      for (let k = 0; k < blockCount; k++) {
        const victim = profiles[rng.int(population)]!;
        if (victim.id !== profile.id) blocked.add(victim.id);
      }
      if (blocked.size > 0) profile.blocked = [...blocked];
    }
  }

  return profiles;
}

export interface PopulationSummary {
  population: number;
  byGender: Record<string, number>;
  bySeekingSize: Record<string, number>;
}

export function summarizePopulation(profiles: readonly Profile[]): PopulationSummary {
  const byGender: Record<string, number> = {};
  const bySeekingSize: Record<string, number> = {};
  for (const profile of profiles) {
    byGender[profile.gender] = (byGender[profile.gender] ?? 0) + 1;
    const key = String(profile.seeking.length);
    bySeekingSize[key] = (bySeekingSize[key] ?? 0) + 1;
  }
  return { population: profiles.length, byGender, bySeekingSize };
}
