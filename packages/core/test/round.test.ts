import { describe, expect, it } from 'vitest';
import { runMatchRound } from '../src/round/index.js';
import { buildPreferenceLists } from '../src/firstdate/index.js';
import { generatePopulation } from '../src/sim/synthetic.js';
import { checkStability } from '../src/gs/stable-marriage.js';

describe('runMatchRound', () => {
  it('produces a stable, one-partner-each matching', () => {
    const population = generatePopulation({ population: 200, seed: 42 });
    const result = runMatchRound(population, { exhaustiveMaxPairs: 0, restarts: 2, randomSteps: 2, seed: 1 });

    // Every pair is cross-side and each person appears at most once.
    const sideA = new Set(result.partition.sideA);
    const sideB = new Set(result.partition.sideB);
    const seen = new Set<string>();
    for (const { a, b } of result.pairs) {
      expect(sideA.has(a)).toBe(true);
      expect(sideB.has(b)).toBe(true);
      expect(seen.has(a)).toBe(false);
      expect(seen.has(b)).toBe(false);
      seen.add(a);
      seen.add(b);
    }

    // partners map is symmetric.
    for (const [id, partner] of result.partners) {
      expect(result.partners.get(partner)).toBe(id);
    }

    expect(result.unmatched.length + result.partners.size).toBe(population.length);
    expect(result.metrics.stable).toBe(true);
    expect(result.metrics.matchRate).toBeLessThanOrEqual(1);
    expect(result.fair.stable).toBe(true);
  });

  it('does not match anyone with an unacceptable partner', () => {
    const population = generatePopulation({ population: 120, seed: 7 });
    const result = runMatchRound(population, { exhaustiveMaxPairs: 0, seed: 1 });

    const byId = new Map(population.map((profile) => [profile.id, profile]));
    for (const [id, partner] of result.partners) {
      const a = byId.get(id)!;
      const b = byId.get(partner)!;
      const bGender = b.gender;
      const aGender = a.gender;
      expect(a.seeking.length === 0 || a.seeking.includes(bGender)).toBe(true);
      expect(b.seeking.length === 0 || b.seeking.includes(aGender)).toBe(true);
    }
  });

  it('is reproducible for a fixed population and seed', () => {
    const population = generatePopulation({ population: 100, seed: 3 });
    const first = runMatchRound(population, { seed: 11, restarts: 2, randomSteps: 2 });
    const second = runMatchRound(population, { seed: 11, restarts: 2, randomSteps: 2 });
    expect(first.pairs).toEqual(second.pairs);
    expect(first.unmatched).toEqual(second.unmatched);
  });

  it('uses the exhaustive path for very small pools', () => {
    const population = generatePopulation({ population: 8, seed: 5 });
    const result = runMatchRound(population, { exhaustiveMaxPairs: 20 });
    expect(result.fair.exhaustiveComplete).toBe(true);
    expect(result.fair.stable).toBe(true);
  });

  it('reports the partition it used consistently with the metrics', () => {
    const population = generatePopulation({ population: 150, seed: 21 });
    const result = runMatchRound(population, { exhaustiveMaxPairs: 0, seed: 2 });
    expect(result.metrics.population).toBe(150);
    expect(result.metrics.matched * 2 + result.unmatched.length).toBe(150);
    expect(result.metrics.matchablePairs).toBe(
      result.partition.totalCompatiblePairs - result.partition.wastedPairs,
    );
  });

  it('passes the stability oracle on a larger pool via the heuristic', () => {
    const population = generatePopulation({ population: 400, seed: 99, clusterCount: 4 });
    const result = runMatchRound(population, {
      exhaustiveMaxPairs: 0,
      restarts: 2,
      randomSteps: 3,
      seed: 4,
    });

    // Independently rebuild the cross-side lists the round used and verify with
    // the stability oracle, rather than trusting the engine's own flag.
    const sideASet = new Set(result.partition.sideA);
    const sideBSet = new Set(result.partition.sideB);
    const allLists = buildPreferenceLists(population, result.config);
    const proposerPrefs = new Map<string, string[]>();
    for (const id of result.partition.sideA) {
      proposerPrefs.set(id, (allLists.get(id) ?? []).filter((candidate) => sideBSet.has(candidate)));
    }
    const receiverPrefs = new Map<string, string[]>();
    for (const id of result.partition.sideB) {
      receiverPrefs.set(id, (allLists.get(id) ?? []).filter((candidate) => sideASet.has(candidate)));
    }

    expect(checkStability(result.fair.pairs, proposerPrefs, receiverPrefs).stable).toBe(true);
  });
});
