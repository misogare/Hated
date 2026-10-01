import { describe, expect, it } from 'vitest';
import fc from 'fast-check';
import { checkStability, galeShapley, rankMap } from '../src/gs/stable-marriage.js';
import { enumerateStableMatchings, invertMatching } from '../src/gs/rotations.js';
import { buildRandomInstance } from './helpers.js';

function instanceOf(
  proposers: string[],
  receivers: string[],
  proposerLists: Record<string, string[]>,
  receiverLists: Record<string, string[]>,
) {
  return {
    proposers,
    receivers,
    proposerPrefs: new Map(Object.entries(proposerLists)),
    receiverPrefs: new Map(Object.entries(receiverLists)),
  };
}

describe('galeShapley', () => {
  it('finds the stable matching on a classic instance', () => {
    // Textbook-style example. Proposer-optimal pairing is a-x, b-y, c-z.
    const instance = instanceOf(
      ['a', 'b', 'c'],
      ['x', 'y', 'z'],
      { a: ['x', 'y', 'z'], b: ['y', 'x', 'z'], c: ['x', 'y', 'z'] },
      { x: ['a', 'b', 'c'], y: ['b', 'a', 'c'], z: ['a', 'b', 'c'] },
    );

    const result = galeShapley(instance);
    expect([...result.pairs.entries()].sort()).toEqual([
      ['a', 'x'],
      ['b', 'y'],
      ['c', 'z'],
    ]);
    expect(checkStability(result.pairs, instance.proposerPrefs, instance.receiverPrefs).stable).toBe(true);
  });

  it('leaves people unmatched when their lists are incomplete', () => {
    const instance = instanceOf(
      ['a', 'b'],
      ['x'],
      { a: ['x'], b: ['x'] },
      { x: ['b'] },
    );
    const result = galeShapley(instance);
    // a is not acceptable to x, so a stays unmatched; b gets x.
    expect(result.pairs.get('b')).toBe('x');
    expect(result.pairs.has('a')).toBe(false);
    expect(result.unmatchedProposers).toContain('a');
  });

  it('never proposes one-sided', () => {
    const instance = instanceOf(['a'], ['x'], { a: ['x'] }, { x: [] });
    const result = galeShapley(instance);
    expect(result.pairs.size).toBe(0);
    expect(result.proposals).toBe(0);
  });

  it('is proposer-optimal', () => {
    const instance = instanceOf(
      ['a', 'b'],
      ['x', 'y'],
      { a: ['x', 'y'], b: ['y', 'x'] },
      { x: ['b', 'a'], y: ['a', 'b'] },
    );
    const result = galeShapley(instance);
    expect([...result.pairs.entries()].sort()).toEqual([
      ['a', 'x'],
      ['b', 'y'],
    ]);
  });
});

describe('galeShapley properties (random instances)', () => {
  const instanceArb = fc
    .record({
      seed: fc.integer({ min: 0, max: 2 ** 30 }),
      proposerCount: fc.integer({ min: 1, max: 4 }),
      receiverCount: fc.integer({ min: 1, max: 4 }),
    })
    .map(({ seed, proposerCount, receiverCount }) =>
      buildRandomInstance(seed, proposerCount, receiverCount),
    );

  it('always returns a stable matching', () => {
    fc.assert(
      fc.property(instanceArb, (instance) => {
        const result = galeShapley(instance);
        const check = checkStability(result.pairs, instance.proposerPrefs, instance.receiverPrefs);
        if (!check.stable) throw new Error(`unstable: ${JSON.stringify(check.blockingPairs)}`);
      }),
      { numRuns: 300 },
    );
  });

  it('matches exactly once and only mutually acceptable pairs', () => {
    fc.assert(
      fc.property(instanceArb, (instance) => {
        const result = galeShapley(instance);
        const seenReceivers = new Set<string>();
        for (const [proposer, receiver] of result.pairs) {
          if (seenReceivers.has(receiver)) throw new Error('receiver matched twice');
          seenReceivers.add(receiver);
          if (!(instance.proposerPrefs.get(proposer) ?? []).includes(receiver)) {
            throw new Error('proposer matched someone not on their list');
          }
          if (!(instance.receiverPrefs.get(receiver) ?? []).includes(proposer)) {
            throw new Error('receiver got a one-sided proposal');
          }
        }
      }),
      { numRuns: 300 },
    );
  });

  it('is proposer-optimal against brute-force enumeration', () => {
    fc.assert(
      fc.property(instanceArb, (instance) => {
        const result = galeShapley(instance);
        const { matchings, complete } = enumerateStableMatchings(instance, { maxNodes: 500_000 });
        if (!complete) return; // enumeration budget exhausted, cannot claim optimality

        const proposerRanks = new Map<string, Map<string, number>>();
        for (const [id, list] of instance.proposerPrefs) proposerRanks.set(id, rankMap(list));

        for (const alternative of matchings) {
          for (const proposer of instance.proposers) {
            const ranks = proposerRanks.get(proposer)!;
            const gsPartner = result.pairs.get(proposer);
            const altPartner = alternative.get(proposer);
            const gsRank = gsPartner === undefined ? Infinity : ranks.get(gsPartner) ?? Infinity;
            const altRank = altPartner === undefined ? Infinity : ranks.get(altPartner) ?? Infinity;
            if (gsRank > altRank) {
              throw new Error(`proposer ${proposer} does better in another stable matching`);
            }
          }
        }
      }),
      { numRuns: 300 },
    );
  });

  it('matches the same number of people in every stable matching (Rural Hospitals)', () => {
    fc.assert(
      fc.property(instanceArb, (instance) => {
        const result = galeShapley(instance);
        const { matchings, complete } = enumerateStableMatchings(instance, { maxNodes: 500_000 });
        if (!complete) return;
        for (const alternative of matchings) {
          if (invertMatching(alternative).size !== result.pairs.size) {
            throw new Error('stable matchings differ in size');
          }
        }
      }),
      { numRuns: 200 },
    );
  });
});
