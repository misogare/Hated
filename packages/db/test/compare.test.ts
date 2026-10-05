import type { FairObjective, SweepCell } from '@hated/core';
import { describe, expect, it } from 'vitest';

import { parseArgs, pickFairest } from '../src/compare.js';

describe('compare parseArgs', () => {
  it('defaults to every objective and the round defaults', () => {
    const args = parseArgs([]);
    expect(args.objectives).toEqual([
      'egalitarian',
      'min-regret',
      'side-equal',
      'proposer-favored',
      'receiver-favored',
    ]);
    expect(args.seed).toBe(42);
    expect(args.topK).toBe(32);
    expect(args.minScore).toBe(0.35);
    expect(args.latticeSample).toBe(128);
    expect(args.includeInactive).toBe(false);
    expect(args.json).toBe(false);
  });

  it('reads a de-duplicated objective list and numeric overrides', () => {
    const args = parseArgs([
      '--objectives',
      'egalitarian,min-regret,egalitarian',
      '--seed',
      '7',
      '--topK',
      '16',
      '--minScore',
      '0.5',
      '--latticeSample',
      '32',
      '--exhaustive',
      '9',
      '--restarts',
      '2',
      '--randomSteps',
      '3',
      '--ids',
      'a, b',
    ]);

    expect(args.objectives).toEqual(['egalitarian', 'min-regret']);
    expect(args.seed).toBe(7);
    expect(args.topK).toBe(16);
    expect(args.minScore).toBe(0.5);
    expect(args.latticeSample).toBe(32);
    expect(args.exhaustive).toBe(9);
    expect(args.restarts).toBe(2);
    expect(args.randomSteps).toBe(3);
    expect(args.ids).toEqual(['a', 'b']);
  });

  it('turns on the boolean flags', () => {
    expect(parseArgs(['--include-inactive']).includeInactive).toBe(true);
    expect(parseArgs(['--json']).json).toBe(true);
    expect(parseArgs(['--help']).help).toBe(true);
  });

  it('rejects unknown flags, bad numbers, and unknown objectives', () => {
    expect(() => parseArgs(['--nope'])).toThrow(/Unknown flag/);
    expect(() => parseArgs(['--seed', 'abc'])).toThrow(/Expected a number/);
    expect(() => parseArgs(['--objectives', 'leftmost'])).toThrow(/--objectives entries/);
    expect(() => parseArgs(['--objectives'])).toThrow(/comma-separated list/);
  });
});

function cell(overrides: Partial<SweepCell> & Pick<SweepCell, 'objective'>): SweepCell {
  return {
    topK: 32,
    minScore: 0.35,
    population: 100,
    matched: 50,
    matchRate: 1,
    firstChoiceRate: 0.5,
    meanCost: 0.2,
    worstCost: 0.5,
    satisfactionGap: 0.1,
    stable: true,
    improvement: 0.01,
    latticeSpan: 0.05,
    latticeRange: 0.08,
    lattice: { exposedRotations: 2, latticeDepth: 3 },
    ...overrides,
  };
}

describe('pickFairest', () => {
  it('picks the smallest gap and lowest cost independently', () => {
    const cells: SweepCell[] = [
      cell({ objective: 'egalitarian' as FairObjective, satisfactionGap: 0.02, meanCost: 0.3 }),
      cell({ objective: 'min-regret' as FairObjective, satisfactionGap: 0.1, meanCost: 0.15 }),
    ];

    const { smallestGap, lowestCost } = pickFairest(cells);
    expect(smallestGap.objective).toBe('egalitarian');
    expect(lowestCost.objective).toBe('min-regret');
  });

  it('breaks a gap tie on mean cost and a cost tie on gap', () => {
    const gapTie: SweepCell[] = [
      cell({ objective: 'egalitarian' as FairObjective, satisfactionGap: 0.05, meanCost: 0.4 }),
      cell({ objective: 'min-regret' as FairObjective, satisfactionGap: 0.05, meanCost: 0.2 }),
    ];
    expect(pickFairest(gapTie).smallestGap.objective).toBe('min-regret');

    const costTie: SweepCell[] = [
      cell({ objective: 'egalitarian' as FairObjective, satisfactionGap: 0.3, meanCost: 0.2 }),
      cell({ objective: 'min-regret' as FairObjective, satisfactionGap: 0.1, meanCost: 0.2 }),
    ];
    expect(pickFairest(costTie).lowestCost.objective).toBe('min-regret');
  });
});
