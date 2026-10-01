/**
 * One match round, end to end.
 *
 * Pipeline:
 *   1. rank everyone's candidates          (FirstDate layer)
 *   2. split the pool into two sides       (orientation-aware partition)
 *   3. keep only cross-side choices        (per-side preference lists)
 *   4. pick a stable matching + objective  (Gale-Shapley + rotation search)
 *   5. report who goes unmatched and how good it was
 *
 * Everyone who can be matched is matched, and exactly once. Nobody swipes.
 */

import type { FirstDateConfig, Profile } from '../types.js';
import {
  DEFAULT_FIRSTDATE_CONFIG,
  buildPreferenceLists,
} from '../firstdate/index.js';
import { partitionSides, type PartitionOptions, type PartitionResult } from '../partition/index.js';
import { findFairMatching, type FairMatcherResult, type FairObjective } from '../gs/fair.js';
import { computeSideMetrics, type RoundMetrics, type SideMetrics } from '../metrics/index.js';

export interface MatchRoundOptions {
  firstDate?: Partial<FirstDateConfig>;
  partition?: PartitionOptions;
  /** Which stable matching to ship. Defaults to min-regret, the fairest worst case. */
  objective?: FairObjective;
  /** Exact-optimum threshold, in matched pairs. */
  exhaustiveMaxPairs?: number;
  /** Randomized restarts for pools too large to solve exactly. */
  restarts?: number;
  randomSteps?: number;
  seed?: number;
}

export interface RoundPair {
  /** Member of side A. */
  a: string;
  /** Member of side B. */
  b: string;
}

export interface RoundResult {
  /** Deterministic, sorted by side A id. */
  pairs: RoundPair[];
  /** Bidirectional lookup: every matched id maps to their partner. */
  partners: Map<string, string>;
  unmatched: string[];
  partition: PartitionResult;
  fair: FairMatcherResult;
  metrics: RoundMetrics;
  config: FirstDateConfig;
  objective: FairObjective;
}

export function runMatchRound(
  profiles: readonly Profile[],
  options: MatchRoundOptions = {},
): RoundResult {
  const config: FirstDateConfig = { ...DEFAULT_FIRSTDATE_CONFIG, ...options.firstDate };
  const objective: FairObjective = options.objective ?? 'min-regret';

  const partition = partitionSides(profiles, options.partition);

  const allLists = buildPreferenceLists(profiles, config);

  const sideASet = new Set(partition.sideA);
  const sideBSet = new Set(partition.sideB);

  const proposerPrefs = new Map<string, string[]>();
  for (const id of partition.sideA) {
    proposerPrefs.set(id, (allLists.get(id) ?? []).filter((candidate) => sideBSet.has(candidate)));
  }
  const receiverPrefs = new Map<string, string[]>();
  for (const id of partition.sideB) {
    receiverPrefs.set(id, (allLists.get(id) ?? []).filter((candidate) => sideASet.has(candidate)));
  }

  const fair = findFairMatching({
    proposers: partition.sideA,
    receivers: partition.sideB,
    proposerPrefs,
    receiverPrefs,
    objective,
    exhaustiveMaxPairs: options.exhaustiveMaxPairs,
    restarts: options.restarts,
    randomSteps: options.randomSteps,
    seed: options.seed,
  });

  const partners = new Map<string, string>();
  for (const [a, b] of fair.pairs) {
    partners.set(a, b);
    partners.set(b, a);
  }

  const pairs: RoundPair[] = [...fair.pairs.entries()]
    .map(([a, b]) => ({ a, b }))
    .sort((x, y) => (x.a < y.a ? -1 : x.a > y.a ? 1 : 0));

  const unmatched = profiles
    .map((profile) => profile.id)
    .filter((id) => !partners.has(id))
    .sort();

  const sideAMetrics: SideMetrics = computeSideMetrics(partition.sideA, proposerPrefs, partners);
  const sideBMetrics: SideMetrics = computeSideMetrics(partition.sideB, receiverPrefs, partners);

  const population = profiles.length;
  const matched = partners.size / 2;

  const metrics: RoundMetrics = {
    population,
    matched,
    matchRate: population === 0 ? 0 : (matched * 2) / population,
    matchablePairs: partition.matchablePairs,
    wastedPairs: partition.wastedPairs,
    totalCompatiblePairs: partition.totalCompatiblePairs,
    sideA: sideAMetrics,
    sideB: sideBMetrics,
    satisfactionGap: Math.abs(sideAMetrics.meanCost - sideBMetrics.meanCost),
    firstChoiceRate: fair.evaluation.firstChoiceRate,
    worstCost: fair.evaluation.worstCost,
    stable: fair.stable,
  };

  return {
    pairs,
    partners,
    unmatched,
    partition,
    fair,
    metrics,
    config,
    objective,
  };
}
