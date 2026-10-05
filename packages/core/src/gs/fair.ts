/**
 * Choosing *which* stable matching to ship.
 *
 * Plain Gale-Shapley returns the proposer-optimal matching. That is stable, but
 * it is simultaneously the best result proposers can ever get and the worst
 * receivers can ever get. On a dating product that asymmetry is a retention
 * problem: a large slice of the pool reliably gets their least attractive
 * outcome, and they can tell.
 *
 * Because the stable matchings form a lattice and rotations navigate it, we can
 * move to a different stable matching that trades a little proposer satisfaction
 * for a much better worst case. Nothing here breaks stability - every candidate
 * we compare is verified stable before it is even scored. We are choosing among
 * valid answers, not relaxing the guarantee.
 *
 * Objectives (all lower-is-better), scored on normalised rank so that people
 * with short preference lists are not artificially advantaged:
 *  - egalitarian     minimise the mean cost across everyone
 *  - min-regret      minimise the *worst* cost anyone suffers
 *  - side-equal      minimise the satisfaction gap between the two sides
 *  - proposer-favored / receiver-favored: commit to one side
 *
 * Exactness caveat, stated plainly: for small instances we enumerate every
 * stable matching and return the true optimum. For large ones we hill-climb the
 * lattice with randomized restarts, which is fast and always yields a stable
 * matching but is not proven globally optimal. The exhaustive path exists
 * precisely so the heuristic can be validated against ground truth in tests.
 */

import { checkStability, galeShapley, rankMap } from './stable-marriage.js';
import {
  applyRotation,
  enumerateStableMatchings,
  findExposedRotations,
  type LatticeInput,
  type Rotation,
} from './rotations.js';
import { createRng } from '../util/random.js';

export type FairObjective =
  | 'egalitarian'
  | 'min-regret'
  | 'side-equal'
  | 'proposer-favored'
  | 'receiver-favored';

export interface FairMatcherInput extends LatticeInput {
  proposers: readonly string[];
  receivers: readonly string[];
  objective: FairObjective;
  /** Use exact enumeration when there are at most this many matched pairs. */
  exhaustiveMaxPairs?: number;
  /** Node budget for the exhaustive search before it gives up and falls back. */
  exhaustiveMaxNodes?: number;
  /** Randomized restarts used by the large-instance search. */
  restarts?: number;
  /** Cap on random rotation steps per restart. */
  randomSteps?: number;
  seed?: number;
}

export interface FairMatcherResult {
  pairs: Map<string, string>;
  objective: FairObjective;
  objectiveValue: number;
  /** Value of the plain textbook matching, for comparison. */
  proposerOptimalValue: number;
  /** Value of the opposite extreme, for comparison. */
  receiverOptimalValue: number;
  /** proposerOptimalValue - objectiveValue. Positive means we improved things. */
  improvement: number;
  strategy: 'exhaustive' | 'rotation-walk' | 'proposer-optimal';
  rotationsApplied: number;
  stable: boolean;
  exhaustiveComplete: boolean;
  evaluation: MatchingEvaluation;
}

export interface MatchingEvaluation {
  meanCost: number;
  proposerMeanCost: number;
  receiverMeanCost: number;
  worstCost: number;
  /** Fraction of people who got their first choice. */
  firstChoiceRate: number;
}

function clamp01(value: number): number {
  if (value < 0) return 0;
  if (value > 1) return 1;
  return value;
}

function normalizedCost(rank: number | undefined, listLength: number): number {
  if (rank === undefined) return 1; // unmatched or unacceptable
  if (listLength <= 1) return 0;
  return clamp01(rank / (listLength - 1));
}

/** Everything needed to score a matching, without committing to an objective. */
export interface MatchingEvaluatorInput {
  proposers: readonly string[];
  receivers: readonly string[];
  proposerPrefs: ReadonlyMap<string, readonly string[]>;
  receiverPrefs: ReadonlyMap<string, readonly string[]>;
}

interface Evaluator {
  evaluate(matching: ReadonlyMap<string, string>): MatchingEvaluation;
}

/**
 * Precompute rank lookups once; every objective is then a cheap pass over the
 * matching. Called a lot during the search, so this avoids O(k) indexOf scans.
 */
function makeEvaluator(input: MatchingEvaluatorInput): Evaluator {
  const proposerRanks = new Map<string, Map<string, number>>();
  for (const [id, list] of input.proposerPrefs) proposerRanks.set(id, rankMap(list));
  const receiverRanks = new Map<string, Map<string, number>>();
  for (const [id, list] of input.receiverPrefs) receiverRanks.set(id, rankMap(list));

  const evaluate = (matching: ReadonlyMap<string, string>): MatchingEvaluation => {
    let proposerSum = 0;
    let receiverSum = 0;
    let worst = 0;
    let firstChoices = 0;
    let counted = 0;

    for (const proposer of input.proposers) {
      const list = input.proposerPrefs.get(proposer) ?? [];
      const partner = matching.get(proposer);
      const rank = partner === undefined ? undefined : proposerRanks.get(proposer)?.get(partner);
      const cost = normalizedCost(rank, list.length);
      proposerSum += cost;
      worst = Math.max(worst, cost);
      if (rank === 0) firstChoices++;
      counted++;
    }

    const partnerOfReceiver = new Map<string, string>();
    for (const [proposer, receiver] of matching) partnerOfReceiver.set(receiver, proposer);

    for (const receiver of input.receivers) {
      const list = input.receiverPrefs.get(receiver) ?? [];
      const partner = partnerOfReceiver.get(receiver);
      const rank = partner === undefined ? undefined : receiverRanks.get(receiver)?.get(partner);
      const cost = normalizedCost(rank, list.length);
      receiverSum += cost;
      worst = Math.max(worst, cost);
      if (rank === 0) firstChoices++;
      counted++;
    }

    const proposerCount = Math.max(1, input.proposers.length);
    const receiverCount = Math.max(1, input.receivers.length);
    const totalCount = Math.max(1, counted);

    return {
      meanCost: (proposerSum + receiverSum) / totalCount,
      proposerMeanCost: proposerSum / proposerCount,
      receiverMeanCost: receiverSum / receiverCount,
      worstCost: worst,
      firstChoiceRate: firstChoices / totalCount,
    };
  };

  return { evaluate };
}

/**
 * Score one matching under the engine's normalised-rank metrics. Exposed so
 * callers can evaluate arbitrary stable matchings - for example to measure how
 * much an objective varies across a sample of the lattice.
 */
export function evaluateMatching(
  input: MatchingEvaluatorInput,
  matching: ReadonlyMap<string, string>,
): MatchingEvaluation {
  return makeEvaluator(input).evaluate(matching);
}

export function objectiveValue(objective: FairObjective, evaluation: MatchingEvaluation): number {
  switch (objective) {
    case 'egalitarian':
      return evaluation.meanCost;
    case 'min-regret':
      return evaluation.worstCost;
    case 'side-equal':
      return Math.abs(evaluation.proposerMeanCost - evaluation.receiverMeanCost);
    case 'proposer-favored':
      return evaluation.proposerMeanCost;
    case 'receiver-favored':
      return evaluation.receiverMeanCost;
  }
}

/**
 * Restrict an instance to the people matched by `matching`, so the exhaustive
 * search only explores the sub-problem that actually matters.
 *
 * Caveat: a matching that is stable on this restricted instance need not be
 * stable on the full one, because an excluded (unmatched) person can still form
 * a blocking pair with someone inside. Callers must re-verify candidates against
 * the full preference lists.
 */
function restrictInstance(
  matching: ReadonlyMap<string, string>,
  input: FairMatcherInput,
): {
  proposers: string[];
  receivers: string[];
  proposerPrefs: Map<string, readonly string[]>;
  receiverPrefs: Map<string, readonly string[]>;
} {
  const matchedProposers = [...matching.keys()].sort();
  const matchedReceivers = new Set(matching.values());
  const receiverOrder = [...matchedReceivers].sort();

  const proposerPrefs = new Map<string, readonly string[]>();
  for (const proposer of matchedProposers) {
    proposerPrefs.set(
      proposer,
      (input.proposerPrefs.get(proposer) ?? []).filter((receiver) => matchedReceivers.has(receiver)),
    );
  }
  const receiverPrefs = new Map<string, readonly string[]>();
  for (const receiver of receiverOrder) {
    receiverPrefs.set(
      receiver,
      (input.receiverPrefs.get(receiver) ?? []).filter((proposer) => matching.has(proposer)),
    );
  }

  return { proposers: matchedProposers, receivers: receiverOrder, proposerPrefs, receiverPrefs };
}

export function findFairMatching(input: FairMatcherInput): FairMatcherResult {
  const evaluator = makeEvaluator(input);

  const proposerOptimal = galeShapley({
    proposers: input.proposers,
    receivers: input.receivers,
    proposerPrefs: input.proposerPrefs,
    receiverPrefs: input.receiverPrefs,
  }).pairs;

  const receiverOptimal = galeShapley({
    // Same instance, roles swapped: this is the receiver-optimal extreme.
    proposers: input.receivers,
    receivers: input.proposers,
    proposerPrefs: input.receiverPrefs,
    receiverPrefs: input.proposerPrefs,
  });

  const receiverOptimalMatching = new Map<string, string>();
  for (const [receiver, proposer] of receiverOptimal.pairs) {
    receiverOptimalMatching.set(proposer, receiver);
  }

  const proposerOptimalEvaluation = evaluator.evaluate(proposerOptimal);
  const receiverOptimalEvaluation = evaluator.evaluate(receiverOptimalMatching);
  const proposerOptimalValue = objectiveValue(input.objective, proposerOptimalEvaluation);
  const receiverOptimalValue = objectiveValue(input.objective, receiverOptimalEvaluation);

  const exhaustiveMaxPairs = input.exhaustiveMaxPairs ?? 9;
  const matchedPairs = proposerOptimal.size;

  let best = proposerOptimal;
  let bestEvaluation = proposerOptimalEvaluation;
  let bestValue = proposerOptimalValue;
  let strategy: FairMatcherResult['strategy'] = 'proposer-optimal';
  let rotationsApplied = 0;
  let exhaustiveComplete = true;

  if (matchedPairs > 0 && matchedPairs <= exhaustiveMaxPairs) {
    // Exact: enumerate the lattice and take the true optimum.
    const restricted = restrictInstance(proposerOptimal, input);
    const { matchings, complete } = enumerateStableMatchings(restricted, {
      maxNodes: input.exhaustiveMaxNodes ?? 200_000,
    });
    exhaustiveComplete = complete;

    if (complete) {
      strategy = 'exhaustive';
      for (const candidate of matchings) {
        // The restricted enumeration only sees the matched subset, so it can
        // surface matchings that are stable *within* that subset but have a
        // blocking pair involving someone excluded from it. Verify against the
        // full instance before trusting a candidate.
        if (!checkStability(candidate, input.proposerPrefs, input.receiverPrefs).stable) continue;
        const evaluation = evaluator.evaluate(candidate);
        const value = objectiveValue(input.objective, evaluation);
        if (value < bestValue - 1e-12) {
          best = candidate;
          bestEvaluation = evaluation;
          bestValue = value;
        }
      }
    }
  }

  if (strategy !== 'exhaustive' && matchedPairs > 0 && input.objective !== 'proposer-favored') {
    const rng = createRng(input.seed ?? 1);
    const restarts = Math.max(1, input.restarts ?? 1);
    const randomSteps = Math.max(0, input.randomSteps ?? 0);

    for (let restart = 0; restart < restarts; restart++) {
      let current = proposerOptimal;
      let currentValue = proposerOptimalValue;
      let steps = 0;

      // On later restarts, wander a few random rotations first so the climb
      // starts from a different basin of the lattice.
      if (restart > 0 && randomSteps > 0) {
        for (let step = 0; step < randomSteps; step++) {
          const rotations = findExposedRotations(current, input);
          if (rotations.length === 0) break;
          const chosen: Rotation = rng.pick(rotations);
          const candidate = applyRotation(current, chosen);
          if (!checkStability(candidate, input.proposerPrefs, input.receiverPrefs).stable) break;
          current = candidate;
          currentValue = objectiveValue(input.objective, evaluator.evaluate(candidate));
          steps++;
        }
      }

      for (;;) {
        const rotations = findExposedRotations(current, input);
        if (rotations.length === 0) break;

        let improvedMatching: Map<string, string> | null = null;
        let improvedValue = currentValue;

        for (const rotation of rotations) {
          const candidate = applyRotation(current, rotation);
          if (!checkStability(candidate, input.proposerPrefs, input.receiverPrefs).stable) continue;
          const value = objectiveValue(input.objective, evaluator.evaluate(candidate));
          if (value < improvedValue - 1e-12) {
            improvedValue = value;
            improvedMatching = candidate;
          }
        }

        if (improvedMatching === null) break;
        current = improvedMatching;
        currentValue = improvedValue;
        steps++;
      }

      if (currentValue < bestValue - 1e-12) {
        best = current;
        bestEvaluation = evaluator.evaluate(current);
        bestValue = currentValue;
        strategy = 'rotation-walk';
        rotationsApplied = steps;
      }
      // If no rotation improved the objective, the shipped matching *is* the
      // proposer-optimal one; keep the label honest.
    }
  }

  const stability = checkStability(best, input.proposerPrefs, input.receiverPrefs);

  return {
    pairs: best,
    objective: input.objective,
    objectiveValue: bestValue,
    proposerOptimalValue,
    receiverOptimalValue,
    improvement: proposerOptimalValue - bestValue,
    strategy,
    rotationsApplied,
    stable: stability.stable,
    exhaustiveComplete,
    evaluation: bestEvaluation,
  };
}
