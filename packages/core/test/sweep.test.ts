import { describe, expect, it } from 'vitest';
import {
  latticeMetrics,
  paretoFrontier,
  runPopulationSweep,
  runSweep,
  sampleLattice,
  summarizeByObjective,
  summarizeLatticeByPopulation,
  type SweepCell,
} from '../src/sim/sweep.js';
import { evaluateMatching, objectiveValue, type FairObjective } from '../src/gs/fair.js';
import { galeShapley } from '../src/gs/stable-marriage.js';
import { generatePopulation } from '../src/sim/synthetic.js';
import { partitionSides } from '../src/partition/index.js';
import { runMatchRound } from '../src/round/index.js';

function cell(overrides: Partial<SweepCell>): SweepCell {
  return {
    topK: 16,
    minScore: 0.3,
    objective: 'egalitarian',
    population: 100,
    matched: 40,
    matchRate: 0.8,
    firstChoiceRate: 0.2,
    meanCost: 0.3,
    worstCost: 1,
    satisfactionGap: 0.05,
    stable: true,
    improvement: 0,
    latticeSpan: 0,
    latticeRange: 0,
    lattice: { exposedRotations: 0, latticeDepth: 0 },
    ...overrides,
  };
}

describe('runSweep', () => {
  it('runs one verified-stable round per (topK, minScore) cell', () => {
    const profiles = generatePopulation({ population: 40, seed: 3 });
    const cells = runSweep(profiles, {
      topKValues: [4, 8],
      minScoreValues: [0.25, 0.5],
      objective: 'egalitarian',
      // Force the heuristic: exact enumeration over a 40-person pool is slow and
      // adds nothing to what this test checks.
      exhaustiveMaxPairs: 0,
      restarts: 2,
      randomSteps: 2,
      seed: 1,
    });

    expect(cells).toHaveLength(4);
    for (const result of cells) {
      expect(result.stable).toBe(true);
      expect(result.matchRate).toBeGreaterThanOrEqual(0);
      expect(result.matchRate).toBeLessThanOrEqual(1);
      expect(result.meanCost).toBeGreaterThanOrEqual(0);
      expect(result.meanCost).toBeLessThanOrEqual(1);
    }

    const combinations = cells.map((result) => `${result.topK}:${result.minScore}`).sort();
    expect(combinations).toEqual(['4:0.25', '4:0.5', '8:0.25', '8:0.5']);
  });

  it('matches more people at a permissive threshold than a strict one', () => {
    const profiles = generatePopulation({ population: 200, seed: 7 });
    const cells = runSweep(profiles, {
      topKValues: [32],
      minScoreValues: [0.0, 0.95],
      exhaustiveMaxPairs: 0,
      restarts: 2,
      randomSteps: 2,
      seed: 1,
    });

    const permissive = cells.find((result) => result.minScore === 0)!;
    const strict = cells.find((result) => result.minScore === 0.95)!;
    expect(strict.matchRate).toBeLessThanOrEqual(permissive.matchRate);
  });

  it('produces the same round when a partition is reused', () => {
    const profiles = generatePopulation({ population: 60, seed: 9 });
    const partitionResult = partitionSides(profiles);

    const withReuse = runMatchRound(profiles, {
      partitionResult,
      firstDate: { topK: 16, minScore: 0.3 },
      seed: 1,
      restarts: 2,
      randomSteps: 2,
    });
    const withoutReuse = runMatchRound(profiles, {
      firstDate: { topK: 16, minScore: 0.3 },
      seed: 1,
      restarts: 2,
      randomSteps: 2,
    });

    expect(withReuse.pairs).toEqual(withoutReuse.pairs);
    expect(withReuse.metrics.matchRate).toBe(withoutReuse.metrics.matchRate);
  });
});

describe('lattice metrics', () => {
  it('measures a known two-matching instance', () => {
    const instance = {
      proposers: ['a', 'b'],
      receivers: ['x', 'y'],
      proposerPrefs: new Map([
        ['a', ['x', 'y']],
        ['b', ['y', 'x']],
      ]),
      receiverPrefs: new Map([
        ['x', ['b', 'a']],
        ['y', ['a', 'b']],
      ]),
    };
    expect(latticeMetrics(instance)).toEqual({ exposedRotations: 1, latticeDepth: 1 });
  });

  it('reports an empty lattice when the stable matching is unique', () => {
    const instance = {
      proposers: ['a'],
      receivers: ['x'],
      proposerPrefs: new Map([['a', ['x']]]),
      receiverPrefs: new Map([['x', ['a']]]),
    };
    expect(latticeMetrics(instance)).toEqual({ exposedRotations: 0, latticeDepth: 0 });
  });
});

describe('lattice range sample', () => {
  it('captures an interior optimum the two extremes miss', () => {
    // Same instance as the fairness rotation test: egalitarian improves from
    // 0.5833 at the proposer-optimal endpoint to 0.5 at an interior matching.
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

    const sample = sampleLattice(instance);
    const values = sample.matchings.map((matching) =>
      objectiveValue('egalitarian', evaluateMatching(instance, matching)),
    );
    const range = Math.max(...values) - Math.min(...values);
    const proposerOptimal = objectiveValue(
      'egalitarian',
      evaluateMatching(instance, galeShapley(instance).pairs),
    );

    expect(range).toBeGreaterThan(0);
    expect(Math.min(...values)).toBeLessThan(proposerOptimal - 1e-9);
    expect(range).toBeGreaterThanOrEqual(proposerOptimal - Math.min(...values) - 1e-9);
  });

  it('reports zero range for a unique stable matching', () => {
    const instance = {
      proposers: ['a'],
      receivers: ['x'],
      proposerPrefs: new Map([['a', ['x']]]),
      receiverPrefs: new Map([['x', ['a']]]),
    };
    expect(sampleLattice(instance).matchings).toHaveLength(1);
  });
});

describe('lattice span', () => {
  it('is never negative and never smaller than the fairness gain it allows', () => {
    const profiles = generatePopulation({ population: 200, seed: 13 });
    const cells = runSweep(profiles, {
      topKValues: [32],
      minScoreValues: [0.5],
      // receiver-optimal is by construction the extreme minimum for this
      // objective, so the shipped gain can never exceed the span.
      objectives: ['receiver-favored'],
      exhaustiveMaxPairs: 0,
      restarts: 3,
      randomSteps: 3,
      seed: 1,
    });

    expect(cells).toHaveLength(1);
    const cell = cells[0]!;
    expect(cell.latticeSpan).toBeGreaterThanOrEqual(0);
    expect(cell.improvement).toBeLessThanOrEqual(cell.latticeSpan + 1e-9);
  });
});

describe('population dimension', () => {
  it('makes everyone share the default weights when weightSpread is 0', () => {
    const fixed = generatePopulation({ population: 30, seed: 5, weightSpread: 0 });
    expect(fixed.every((profile) => profile.weights !== undefined)).toBe(true);
    const distinct = new Set(
      fixed.map(
        (profile) =>
          `${profile.weights!.similarityWeight}|${profile.weights!.desireWeight}|${profile.weights!.reciprocityWeight}`,
      ),
    );
    expect(distinct.size).toBe(1);

    const varied = generatePopulation({ population: 200, seed: 5, weightSpread: 1 });
    const spreads = new Set(varied.map((profile) => profile.weights!.similarityWeight.toFixed(6)));
    expect(spreads.size).toBeGreaterThan(1);
  });

  it('stamps each cell with the population that produced it', () => {
    const cells = runPopulationSweep(
      { population: 60, seed: 4, clusterCounts: [3, 5], weightSpreads: [0, 1] },
      {
        topKValues: [8],
        minScoreValues: [0.5],
        objectives: ['egalitarian', 'side-equal'],
        exhaustiveMaxPairs: 0,
        restarts: 2,
        randomSteps: 2,
        seed: 1,
      },
    );

    expect(cells).toHaveLength(2 * 2 * 1 * 1 * 2);
    const labels = new Set(cells.map((cell) => `${cell.clusterCount}|${cell.weightSpread}`));
    expect(labels.size).toBe(4);
    for (const cell of cells) {
      expect(cell.stable).toBe(true);
      expect(cell.lattice.exposedRotations).toBeGreaterThanOrEqual(0);
      expect(cell.lattice.latticeDepth).toBeGreaterThanOrEqual(0);
    }
  });

  it('summarises the lattice per population', () => {
    const cells = runPopulationSweep(
      { population: 60, seed: 4, clusterCounts: [3, 9], weightSpreads: [0, 1] },
      {
        topKValues: [8],
        minScoreValues: [0.5],
        objectives: ['egalitarian', 'side-equal'],
        exhaustiveMaxPairs: 0,
        restarts: 2,
        randomSteps: 2,
        seed: 1,
      },
    );

    const summaries = summarizeLatticeByPopulation(cells);
    expect(summaries).toHaveLength(4);
    expect(summaries.map((entry) => entry.cells)).toEqual([2, 2, 2, 2]);
    expect(summaries.map((entry) => `${entry.clusterCount}|${entry.weightSpread}`)).toEqual([
      '3|0',
      '3|1',
      '9|0',
      '9|1',
    ]);
    for (const entry of summaries) {
      expect(entry.meanExposedRotations).toBeGreaterThanOrEqual(0);
      expect(entry.maxLatticeDepth).toBeGreaterThanOrEqual(entry.meanLatticeDepth);
      expect(entry.meanSpan).toBeGreaterThanOrEqual(0);
      expect(entry.meanRange).toBeGreaterThanOrEqual(0);
    }
  });
});

describe('objective dimension', () => {
  const ALL_OBJECTIVES: FairObjective[] = [
    'egalitarian',
    'min-regret',
    'side-equal',
    'proposer-favored',
    'receiver-favored',
  ];

  function multiObjectiveCells() {
    const profiles = generatePopulation({ population: 200, seed: 7 });
    return runSweep(profiles, {
      topKValues: [16],
      minScoreValues: [0.5],
      objectives: ALL_OBJECTIVES,
      exhaustiveMaxPairs: 0,
      restarts: 2,
      randomSteps: 2,
      seed: 1,
    });
  }

  it('runs the grid once per objective and tags each cell', () => {
    const cells = multiObjectiveCells();
    expect(cells).toHaveLength(ALL_OBJECTIVES.length);
    expect(cells.map((entry) => entry.objective).sort()).toEqual([...ALL_OBJECTIVES].sort());
  });

  it('matches the same number of people for every objective (Rural Hospitals)', () => {
    const cells = multiObjectiveCells();
    const matchedCounts = new Set(cells.map((entry) => entry.matched));
    expect(matchedCounts.size).toBe(1);
    for (const entry of cells) expect(entry.stable).toBe(true);
  });

  it('summarises cost and gap per objective', () => {
    const summaries = summarizeByObjective(multiObjectiveCells());
    expect(summaries).toHaveLength(ALL_OBJECTIVES.length);
    for (const summary of summaries) {
      expect(summary.cells).toBe(1);
      expect(summary.meanMatchRate).toBeGreaterThan(0);
      expect(summary.meanGap).toBeGreaterThanOrEqual(0);
      expect(summary.worstGap).toBeGreaterThanOrEqual(summary.meanGap);
      expect(summary.meanSpan).toBeGreaterThanOrEqual(0);
      expect(summary.maxSpan).toBeGreaterThanOrEqual(summary.meanSpan);
      expect(summary.meanRange).toBeGreaterThanOrEqual(0);
    }
  });

  it('defaults to the single objective when no objective list is given', () => {
    const profiles = generatePopulation({ population: 40, seed: 11 });
    const cells = runSweep(profiles, {
      topKValues: [8],
      minScoreValues: [0.5],
      objective: 'side-equal',
      exhaustiveMaxPairs: 0,
      seed: 1,
    });
    expect(cells).toHaveLength(1);
    expect(cells[0]!.objective).toBe('side-equal');
  });
});

describe('paretoFrontier', () => {
  it('keeps only cells nobody beats on both axes', () => {
    const a = cell({ topK: 4, matchRate: 0.5, meanCost: 0.2 });
    const b = cell({ topK: 16, matchRate: 0.8, meanCost: 0.4 });
    const dominatedByA = cell({ topK: 8, matchRate: 0.5, meanCost: 0.3 });
    const dominatedByB = cell({ topK: 32, matchRate: 0.6, meanCost: 0.5 });
    const c = cell({ topK: 64, matchRate: 0.9, meanCost: 0.6 });

    const frontier = paretoFrontier([a, b, dominatedByA, dominatedByB, c]);
    expect(frontier.map((entry) => entry.topK)).toEqual([4, 16, 64]);
  });

  it('returns an empty frontier for an empty grid', () => {
    expect(paretoFrontier([])).toEqual([]);
  });

  it('sorts the frontier by increasing match rate', () => {
    const low = cell({ topK: 4, matchRate: 0.3, meanCost: 0.1 });
    const mid = cell({ topK: 8, matchRate: 0.6, meanCost: 0.25 });
    const high = cell({ topK: 16, matchRate: 0.9, meanCost: 0.5 });
    const frontier = paretoFrontier([high, low, mid]);
    expect(frontier.map((entry) => entry.matchRate)).toEqual([0.3, 0.6, 0.9]);
  });
});
