/**
 * Orientation-aware side partitioning.
 *
 * Gale-Shapley needs two disjoint sides. Real dating pools are not so tidy:
 * people are straight, gay, bi/pan, non-binary, and the pool sizes differ. A
 * naive split (men here, women there) either drops non-straight users or
 * produces a graph with no edges across it, which means zero matches.
 *
 * We instead treat sides as an assignment problem. Two people are *compatible*
 * when each is in the other's `seeking` set. A compatible pair is only usable
 * if the two sit on opposite sides, so the cost we minimise is the number of
 * compatible pairs stranded on the same side (a max-cut problem, NP-hard in
 * general). A single-vertex flip gets stuck whenever a vertex has exactly as
 * many same-side as other-side neighbours, so we run the local search from
 * several deterministic seeds plus randomized restarts and keep the best split.
 *
 * Note on balance: you cannot rescue a lopsided pool with a better partition.
 * By the Rural Hospitals theorem, every stable matching of a given instance
 * matches the same *number* of people. If the pool is 700/300, roughly 400 people
 * go unmatched no matter how clever the algorithm is. Fix that with a bigger
 * pool or a lower score threshold, not with more search.
 */

import type { Profile } from '../types.js';
import { compareIds, isMutuallyAcceptable } from '../firstdate/index.js';
import { createRng, type Rng } from '../util/random.js';

export interface PartitionOptions {
  /**
   * Weight on |sideA - sideB| in the objective. Kept tiny on purpose: it should
   * only choose among splits that strand an equal number of pairs, never trade
   * away real matches for cosmetic symmetry.
   */
  balanceWeight?: number;
  /** Safety bound on local-search sweeps per start. */
  maxSweeps?: number;
  /** Additional randomized restarts on top of the deterministic seeds. */
  restarts?: number;
  /** Seed for the randomized restarts. */
  seed?: number;
}

export interface PartitionResult {
  /** Ids on side A, sorted for determinism. */
  sideA: string[];
  /** Ids on side B, sorted for determinism. */
  sideB: string[];
  /** Compatible pairs that landed on opposite sides and can therefore be matched. */
  matchablePairs: number;
  /** Compatible pairs stranded on the same side. Lower is better. */
  wastedPairs: number;
  /** Compatible pairs in the whole pool, independent of the split. */
  totalCompatiblePairs: number;
  /** sideA.length - sideB.length. */
  balance: number;
  sweeps: number;
  flips: number;
}

const EMPTY_PARTITION: PartitionResult = {
  sideA: [],
  sideB: [],
  matchablePairs: 0,
  wastedPairs: 0,
  totalCompatiblePairs: 0,
  balance: 0,
  sweeps: 0,
  flips: 0,
};

interface LocalSearchResult {
  side: Uint8Array;
  wasted: number;
  sizeA: number;
  sizeB: number;
  sweeps: number;
  flips: number;
  /** wasted + balanceWeight * |sizeA - sizeB|. Lower is better. */
  score: number;
}

export function partitionSides(
  profiles: readonly Profile[],
  options: PartitionOptions = {},
): PartitionResult {
  const n = profiles.length;
  if (n === 0) return EMPTY_PARTITION;

  const balanceWeight = options.balanceWeight ?? 0.001;
  const maxSweeps = options.maxSweeps ?? 200;
  const restarts = Math.max(0, options.restarts ?? 3);
  const rng = createRng(options.seed ?? 0);

  const compatibility = buildCompatibilityGraph(profiles);
  const { adjacency } = compatibility;

  // Deterministic seeds that cover the natural splits, then randomized restarts.
  const seeds: Uint8Array[] = [
    alternatingSeed(profiles),
    genderParitySeed(profiles),
    indexParitySeed(n),
  ];
  for (let i = 0; i < restarts; i++) seeds.push(randomSeed(n, rng));

  let best: LocalSearchResult | null = null;
  for (const seed of seeds) {
    const result = localSearch(adjacency, seed, balanceWeight, maxSweeps);
    if (best === null || result.score < best.score - 1e-12) best = result;
  }

  // `best` is never null: `seeds` always has at least one entry.
  const chosen = best as LocalSearchResult;

  const sideAIds: string[] = [];
  const sideBIds: string[] = [];
  const byId = indicesSortedBy(profiles, (a, b) => compareIds(profiles[a]!.id, profiles[b]!.id));
  for (const i of byId) {
    (chosen.side[i] === 0 ? sideAIds : sideBIds).push(profiles[i]!.id);
  }

  return {
    sideA: sideAIds,
    sideB: sideBIds,
    matchablePairs: compatibility.totalPairs - chosen.wasted,
    wastedPairs: chosen.wasted,
    totalCompatiblePairs: compatibility.totalPairs,
    balance: chosen.sizeA - chosen.sizeB,
    sweeps: chosen.sweeps,
    flips: chosen.flips,
  };
}

/**
 * Single-vertex-flip local search: flipping a vertex swaps `sameSide` stranded
 * edges for `otherSide` matchable ones, and nudges the size balance.
 */
function localSearch(
  adjacency: readonly number[][],
  side: Uint8Array,
  balanceWeight: number,
  maxSweeps: number,
): LocalSearchResult {
  const n = side.length;
  let sizeA = 0;
  for (let i = 0; i < n; i++) if (side[i] === 0) sizeA++;
  let sizeB = n - sizeA;

  let wasted = 0;
  for (let i = 0; i < n; i++) {
    for (const j of adjacency[i]!) {
      if (j > i && side[j] === side[i]) wasted++;
    }
  }

  let sweeps = 0;
  let flips = 0;

  for (; sweeps < maxSweeps; sweeps++) {
    let improvedThisSweep = false;

    for (let i = 0; i < n; i++) {
      const current = side[i]!;
      let sameSide = 0;
      let otherSide = 0;
      for (const j of adjacency[i]!) {
        if (side[j] === current) sameSide++;
        else otherSide++;
      }

      const deltaWasted = otherSide - sameSide;
      const newA = current === 0 ? sizeA - 1 : sizeA + 1;
      const newB = n - newA;
      const deltaBalance = Math.abs(newA - newB) - Math.abs(sizeA - sizeB);

      if (deltaWasted + balanceWeight * deltaBalance < 0) {
        side[i] = current === 0 ? 1 : 0;
        wasted += deltaWasted;
        sizeA = newA;
        sizeB = newB;
        flips++;
        improvedThisSweep = true;
      }
    }

    if (!improvedThisSweep) break;
  }

  return {
    side,
    wasted,
    sizeA,
    sizeB,
    sweeps,
    flips,
    score: wasted + balanceWeight * Math.abs(sizeA - sizeB),
  };
}

/** Group by gender, alternate within the gender-sorted order (spreads each gender across both sides). */
function alternatingSeed(profiles: readonly Profile[]): Uint8Array {
  const n = profiles.length;
  const side = new Uint8Array(n);
  const order = indicesSortedBy(profiles, (a, b) => {
    const gender = compareIds(profiles[a]!.gender, profiles[b]!.gender);
    return gender !== 0 ? gender : compareIds(profiles[a]!.id, profiles[b]!.id);
  });
  for (let k = 0; k < order.length; k++) side[order[k]!] = k % 2;
  return side;
}

/** Put whole genders on alternating sides (clean split for a two-gender straight pool). */
function genderParitySeed(profiles: readonly Profile[]): Uint8Array {
  const n = profiles.length;
  const side = new Uint8Array(n);
  const genders = [...new Set(profiles.map((profile) => profile.gender))].sort(compareIds);
  const parity = new Map(genders.map((gender, index) => [gender, index % 2]));
  profiles.forEach((profile, index) => {
    side[index] = parity.get(profile.gender)!;
  });
  return side;
}

/** Spread by input position, ignoring attributes entirely. */
function indexParitySeed(n: number): Uint8Array {
  const side = new Uint8Array(n);
  for (let i = 0; i < n; i++) side[i] = i % 2;
  return side;
}

function randomSeed(n: number, rng: Rng): Uint8Array {
  const side = new Uint8Array(n);
  for (let i = 0; i < n; i++) side[i] = rng.int(2);
  return side;
}

export interface CompatibilityGraph {
  /** adjacency[i] = indices mutually compatible with i. */
  adjacency: number[][];
  totalPairs: number;
}

/**
 * Undirected graph of mutually acceptable pairs. This is the source of truth for
 * who *could* match, and it is the only O(n^2) step in the pipeline.
 */
export function buildCompatibilityGraph(profiles: readonly Profile[]): CompatibilityGraph {
  const n = profiles.length;
  const adjacency: number[][] = Array.from({ length: n }, () => []);
  let totalPairs = 0;
  for (let i = 0; i < n; i++) {
    for (let j = i + 1; j < n; j++) {
      if (isMutuallyAcceptable(profiles[i]!, profiles[j]!)) {
        adjacency[i]!.push(j);
        adjacency[j]!.push(i);
        totalPairs++;
      }
    }
  }
  return { adjacency, totalPairs };
}

function indicesSortedBy(
  profiles: readonly Profile[],
  compare: (a: number, b: number) => number,
): number[] {
  const indices = profiles.map((_, index) => index);
  indices.sort((a, b) => {
    const result = compare(a, b);
    return result !== 0 ? result : a - b; // final tie-break: stable on position
  });
  return indices;
}
