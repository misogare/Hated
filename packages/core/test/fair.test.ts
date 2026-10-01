import { describe, expect, it } from 'vitest';
import fc from 'fast-check';
import { findFairMatching, objectiveValue, type FairObjective } from '../src/gs/fair.js';
import { checkStability } from '../src/gs/stable-marriage.js';
import { enumerateStableMatchings } from '../src/gs/rotations.js';
import { buildRandomInstance } from './helpers.js';

const OBJECTIVES: FairObjective[] = [
  'egalitarian',
  'min-regret',
  'side-equal',
  'proposer-favored',
  'receiver-favored',
];

/**
 * Local brute-force objective evaluation that mirrors fair.ts's normalized-rank
 * scoring, so tests can compare against the exhaustive search independently.
 * Unmatched people cost 1, matching the engine's convention.
 */
function evaluateMatching(
  matching: ReadonlyMap<string, string>,
  instance: ReturnType<typeof buildRandomInstance>,
  objective: FairObjective,
): number {
  const costOf = (list: readonly string[], id: string | undefined): number => {
    if (id === undefined) return 1;
    const rank = list.indexOf(id);
    if (rank < 0) return 1;
    if (list.length <= 1) return 0;
    return rank / (list.length - 1);
  };

  const inverse = new Map<string, string>();
  for (const [proposer, receiver] of matching) inverse.set(receiver, proposer);

  let proposerSum = 0;
  let receiverSum = 0;
  let worst = 0;
  for (const proposer of instance.proposers) {
    const cost = costOf(instance.proposerPrefs.get(proposer) ?? [], matching.get(proposer));
    proposerSum += cost;
    worst = Math.max(worst, cost);
  }
  for (const receiver of instance.receivers) {
    const cost = costOf(instance.receiverPrefs.get(receiver) ?? [], inverse.get(receiver));
    receiverSum += cost;
    worst = Math.max(worst, cost);
  }

  return objectiveValue(objective, {
    meanCost:
      (proposerSum + receiverSum) /
      Math.max(1, instance.proposers.length + instance.receivers.length),
    proposerMeanCost: proposerSum / Math.max(1, instance.proposers.length),
    receiverMeanCost: receiverSum / Math.max(1, instance.receivers.length),
    worstCost: worst,
    firstChoiceRate: 0,
  });
}

describe('findFairMatching', () => {
  it('always returns a stable matching for every objective', () => {
    const instance = buildRandomInstance(12345, 5, 5);
    for (const objective of OBJECTIVES) {
      const result = findFairMatching({ ...instance, objective, exhaustiveMaxPairs: 20, seed: 1 });
      expect(result.stable).toBe(true);
      expect(checkStability(result.pairs, instance.proposerPrefs, instance.receiverPrefs).stable).toBe(
        true,
      );
    }
  });

  it('is deterministic for a fixed seed', () => {
    const instance = buildRandomInstance(999, 6, 6);
    const options = { objective: 'min-regret' as const, seed: 7, restarts: 3, randomSteps: 4 };
    const first = findFairMatching({ ...instance, ...options });
    const second = findFairMatching({ ...instance, ...options });
    expect([...first.pairs.entries()].sort()).toEqual([...second.pairs.entries()].sort());
  });

  it('matches the proposer-optimal value when the proposing side is favoured', () => {
    const instance = buildRandomInstance(4242, 4, 4);
    const result = findFairMatching({
      ...instance,
      objective: 'proposer-favored',
      exhaustiveMaxPairs: 20,
    });
    expect(result.objectiveValue).toBeCloseTo(result.proposerOptimalValue, 12);
  });

  it('rotation-walk strictly improves on the textbook matching', () => {
    // Asymmetric instance where the proposer-optimal matching is not optimal for
    // the egalitarian objective; a rotation walk should beat it.
    const instance = {
      proposers: ['p0', 'p1', 'p2'],
      receivers: ['r0', 'r1', 'r2'],
      proposerPrefs: new Map([
        ['p0', ['r2', 'r1', 'r0']],
        ['p1', ['r2', 'r1']],
        ['p2', ['r1', 'r2', 'r0']],
      ]),
      receiverPrefs: new Map([
        ['r0', ['p0', 'p1']],
        ['r1', ['p0', 'p2']],
        ['r2', ['p2', 'p0', 'p1']],
      ]),
    };

    const result = findFairMatching({
      ...instance,
      objective: 'egalitarian',
      exhaustiveMaxPairs: 0, // force the lattice walk
      restarts: 4,
      randomSteps: 4,
      seed: 1,
    });

    expect(result.strategy).toBe('rotation-walk');
    expect(result.stable).toBe(true);
    expect(result.objectiveValue).toBeLessThan(result.proposerOptimalValue - 1e-9);
    expect(
      checkStability(result.pairs, instance.proposerPrefs, instance.receiverPrefs).stable,
    ).toBe(true);
  });

  it('never returns a worse value than the textbook matching', () => {
    fc.assert(
      fc.property(fc.integer({ min: 0, max: 2 ** 30 }), (seed) => {
        const instance = buildRandomInstance(seed, 4, 4);
        const result = findFairMatching({ ...instance, objective: 'min-regret', exhaustiveMaxPairs: 50 });
        if (result.objectiveValue > result.proposerOptimalValue + 1e-9) {
          throw new Error('fair search regressed past proposer-optimal');
        }
      }),
      { numRuns: 200 },
    );
  });
});

describe('exhaustive search stays stable on the full instance', () => {
  // Regression: restricting enumeration to the matched subset made a matching
  // look stable even though an unmatched proposer (p2) could still block it.
  const instance = {
    proposers: ['p0', 'p1', 'p2'],
    receivers: ['r0', 'r1', 'r2'],
    proposerPrefs: new Map([
      ['p0', ['r1', 'r2']],
      ['p1', ['r2', 'r0', 'r1']],
      ['p2', ['r2']],
    ]),
    receiverPrefs: new Map([
      ['r0', []],
      ['r1', ['p1', 'p0']],
      ['r2', ['p0', 'p2', 'p1']],
    ]),
  };

  it('never returns a subset-stable but globally unstable matching', () => {
    const result = findFairMatching({
      ...instance,
      objective: 'proposer-favored',
      exhaustiveMaxPairs: 50,
    });
    expect(result.strategy).toBe('exhaustive');
    expect(result.stable).toBe(true);
    expect(
      checkStability(result.pairs, instance.proposerPrefs, instance.receiverPrefs).stable,
    ).toBe(true);
    // The only full-instance stable matching gives every proposer their worst cost.
    expect(result.objectiveValue).toBeCloseTo(1, 12);
  });

  it('returns a verified-stable matching for every objective and random pool', () => {
    fc.assert(
      fc.property(fc.integer({ min: 0, max: 2 ** 30 }), (seed) => {
        const random = buildRandomInstance(seed, 4, 4);
        for (const objective of OBJECTIVES) {
          const result = findFairMatching({
            ...random,
            objective,
            exhaustiveMaxPairs: 50,
          });
          if (!result.stable) throw new Error(`unstable result for ${objective}`);
          if (!checkStability(result.pairs, random.proposerPrefs, random.receiverPrefs).stable) {
            throw new Error(`full-instance oracle rejected ${objective}`);
          }
        }
      }),
      { numRuns: 200 },
    );
  });
});

describe('exhaustive search is a true optimum', () => {
  it('agrees with brute force over every stable matching', () => {
    fc.assert(
      fc.property(
        fc.record({
          seed: fc.integer({ min: 0, max: 2 ** 30 }),
          size: fc.integer({ min: 1, max: 3 }),
        }),
        ({ seed, size }) => {
          const instance = buildRandomInstance(seed, size, size);
          const { matchings, complete } = enumerateStableMatchings(instance, { maxNodes: 500_000 });
          if (!complete || matchings.length === 0) return;

          for (const objective of OBJECTIVES) {
            const result = findFairMatching({
              ...instance,
              objective,
              exhaustiveMaxPairs: 50,
              exhaustiveMaxNodes: 500_000,
            });
            if (result.strategy !== 'exhaustive') continue;

            const brute = matchings
              .map((matching) => evaluateMatching(matching, instance, objective))
              .reduce((min, value) => Math.min(min, value), Infinity);

            if (Math.abs(result.objectiveValue - brute) > 1e-9) {
              throw new Error(
                `objective ${objective}: exhaustive ${result.objectiveValue} vs brute ${brute}`,
              );
            }
          }
        },
      ),
      { numRuns: 120 },
    );
  });
});

describe('heuristic never beats the true optimum', () => {
  it('rotation-walk stays at or above the exhaustive value', () => {
    fc.assert(
      fc.property(
        fc.record({
          seed: fc.integer({ min: 0, max: 2 ** 30 }),
          size: fc.integer({ min: 2, max: 3 }),
        }),
        ({ seed, size }) => {
          const instance = buildRandomInstance(seed, size, size);
          const exhaustive = findFairMatching({
            ...instance,
            objective: 'egalitarian',
            exhaustiveMaxPairs: 50,
          });
          if (exhaustive.strategy !== 'exhaustive') return;

          const heuristic = findFairMatching({
            ...instance,
            objective: 'egalitarian',
            exhaustiveMaxPairs: 0, // force the lattice walk
            restarts: 4,
            randomSteps: 4,
            seed: 3,
          });
          if (heuristic.objectiveValue < exhaustive.objectiveValue - 1e-9) {
            throw new Error('heuristic found something better than the proven optimum');
          }
          if (!heuristic.stable) throw new Error('heuristic result unstable');
        },
      ),
      { numRuns: 120 },
    );
  });
});
