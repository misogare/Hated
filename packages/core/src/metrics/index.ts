/**
 * Quality metrics for a match round.
 *
 * These exist so a change to the scoring weights or the fairness objective can
 * be judged on outcomes rather than vibes: match rate, how much of the pool got
 * a first choice, and how wide the satisfaction gap between the two sides is.
 */

export interface SideMetrics {
  population: number;
  matched: number;
  matchRate: number;
  /** Mean normalised rank of the assigned partner (0 = first choice, 1 = last/unmatched). */
  meanCost: number;
  firstChoiceRate: number;
  worstCost: number;
}

export interface RoundMetrics {
  population: number;
  matched: number;
  matchRate: number;
  /** Pairs that were compatible and land on opposite sides, so could be matched. */
  matchablePairs: number;
  /** Compatible pairs stranded on the same side by the partition. */
  wastedPairs: number;
  /** Compatible pairs in the pool regardless of the split. */
  totalCompatiblePairs: number;
  sideA: SideMetrics;
  sideB: SideMetrics;
  /** |sideA.meanCost - sideB.meanCost|. Zero is a perfectly even outcome. */
  satisfactionGap: number;
  firstChoiceRate: number;
  worstCost: number;
  stable: boolean;
}

function normalizedCost(rank: number | undefined, listLength: number): number {
  if (rank === undefined) return 1;
  if (listLength <= 1) return 0;
  return Math.min(1, Math.max(0, rank / (listLength - 1)));
}

export function computeSideMetrics(
  ids: readonly string[],
  prefs: ReadonlyMap<string, readonly string[]>,
  partners: ReadonlyMap<string, string>,
): SideMetrics {
  if (ids.length === 0) {
    return { population: 0, matched: 0, matchRate: 0, meanCost: 0, firstChoiceRate: 0, worstCost: 0 };
  }

  let sum = 0;
  let matched = 0;
  let firstChoices = 0;
  let worst = 0;

  for (const id of ids) {
    const list = prefs.get(id) ?? [];
    const partner = partners.get(id);
    if (partner === undefined) {
      sum += 1;
      worst = Math.max(worst, 1);
      continue;
    }
    matched++;
    const rank = list.indexOf(partner);
    const cost = normalizedCost(rank < 0 ? undefined : rank, list.length);
    sum += cost;
    worst = Math.max(worst, cost);
    if (rank === 0) firstChoices++;
  }

  return {
    population: ids.length,
    matched,
    matchRate: matched / ids.length,
    meanCost: sum / ids.length,
    firstChoiceRate: firstChoices / ids.length,
    worstCost: worst,
  };
}
