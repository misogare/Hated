import { describe, expect, it } from 'vitest';
import fc from 'fast-check';
import { checkStability, galeShapley, rankMap } from '../src/gs/stable-marriage.js';
import {
  applyRotation,
  buildReducedLists,
  enumerateStableMatchings,
  findExposedRotations,
  invertMatching,
} from '../src/gs/rotations.js';
import { buildRandomInstance } from './helpers.js';

describe('applyRotation', () => {
  it('reassigns each proposer to the next receiver in the cycle', () => {
    const matching = new Map([
      ['a', 'x'],
      ['b', 'y'],
      ['c', 'z'],
    ]);
    const rotated = applyRotation(matching, {
      pairs: [
        ['a', 'x'],
        ['b', 'y'],
        ['c', 'z'],
      ],
    });
    expect(rotated.get('a')).toBe('y');
    expect(rotated.get('b')).toBe('z');
    expect(rotated.get('c')).toBe('x');
  });
});

describe('rotation walk properties', () => {
  const instanceArb = fc
    .record({
      seed: fc.integer({ min: 0, max: 2 ** 30 }),
      proposerCount: fc.integer({ min: 1, max: 4 }),
      receiverCount: fc.integer({ min: 1, max: 4 }),
    })
    .map(({ seed, proposerCount, receiverCount }) =>
      buildRandomInstance(seed, proposerCount, receiverCount),
    );

  it('every exposed rotation leads to another stable matching', () => {
    fc.assert(
      fc.property(instanceArb, (instance) => {
        let matching = galeShapley(instance).pairs;
        const seen = new Set<string>();
        for (let step = 0; step < 50; step++) {
          const rotations = findExposedRotations(matching, instance);
          if (rotations.length === 0) break;
          for (const rotation of rotations) {
            const candidate = applyRotation(matching, rotation);
            const check = checkStability(candidate, instance.proposerPrefs, instance.receiverPrefs);
            if (!check.stable) throw new Error('rotation produced an unstable matching');
          }
          const key = JSON.stringify([...matching.entries()].sort());
          if (seen.has(key)) break;
          seen.add(key);
          matching = applyRotation(matching, rotations[0]!);
        }
      }),
      { numRuns: 200 },
    );
  });

  it('reduced lists contain only upgrades the other side would accept', () => {
    fc.assert(
      fc.property(instanceArb, (instance) => {
        const matching = galeShapley(instance).pairs;
        const reduced = buildReducedLists(matching, instance);
        const inverse = invertMatching(matching);

        for (const [receiver, list] of reduced.receiverList) {
          const full = instance.receiverPrefs.get(receiver) ?? [];
          const partnerRank = full.indexOf(inverse.get(receiver)!);
          for (const proposer of list) {
            if (full.indexOf(proposer) >= partnerRank) {
              throw new Error(`${proposer} is not an upgrade for ${receiver}`);
            }
          }
        }

        for (const [proposer, list] of reduced.proposerList) {
          const full = instance.proposerPrefs.get(proposer) ?? [];
          // Every entry must be a receiver that would actually accept them.
          for (const receiver of list) {
            if (!(reduced.receiverList.get(receiver) ?? []).includes(proposer)) {
              throw new Error(`${receiver} would not accept ${proposer}`);
            }
          }
          // Ordering follows the proposer's own preference.
          const ranks = list.map((receiver) => full.indexOf(receiver));
          for (let i = 1; i < ranks.length; i++) {
            if (ranks[i]! < ranks[i - 1]!) throw new Error(`proposer list unordered for ${proposer}`);
          }
          // The current partner is never an upgrade target.
          if (list.includes(matching.get(proposer)!)) {
            throw new Error(`partner appears as an upgrade for ${proposer}`);
          }
        }
      }),
      { numRuns: 200 },
    );
  });

  it('every enumerated matching is stable and proposer-optimal is among them', () => {
    fc.assert(
      fc.property(instanceArb, (instance) => {
        const { matchings, complete } = enumerateStableMatchings(instance, { maxNodes: 500_000 });
        if (!complete) return;
        if (matchings.length === 0) throw new Error('no stable matching found');

        for (const matching of matchings) {
          if (!checkStability(matching, instance.proposerPrefs, instance.receiverPrefs).stable) {
            throw new Error('enumeration returned an unstable matching');
          }
        }

        const gs = galeShapley(instance).pairs;
        const gsKey = JSON.stringify([...gs.entries()].sort());
        const found = matchings.some(
          (matching) => JSON.stringify([...matching.entries()].sort()) === gsKey,
        );
        if (!found) throw new Error('proposer-optimal matching missing from enumeration');
      }),
      { numRuns: 200 },
    );
  });
});

describe('rotation discovery on a known instance', () => {
  // Two stable matchings exist here; this is the classic "rotation" example.
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

  it('enumerates both stable matchings', () => {
    const { matchings, complete } = enumerateStableMatchings(instance, { maxNodes: 10_000 });
    expect(complete).toBe(true);
    expect(matchings).toHaveLength(2);
  });

  it('finds exactly one exposed rotation at the proposer-optimal matching', () => {
    const gs = galeShapley(instance).pairs;
    const rotations = findExposedRotations(gs, instance);
    expect(rotations).toHaveLength(1);
    expect(rotations[0]!.pairs).toEqual([
      ['a', 'x'],
      ['b', 'y'],
    ]);

    const rotated = applyRotation(gs, rotations[0]!);
    expect(rotated.get('a')).toBe('y');
    expect(rotated.get('b')).toBe('x');
    expect(checkStability(rotated, instance.proposerPrefs, instance.receiverPrefs).stable).toBe(true);

    // `rotated` is the receiver-optimal extreme, so no rotation is exposed.
    expect(findExposedRotations(rotated, instance)).toHaveLength(0);
  });

  it('the two extremes are the two enumerable matchings', () => {
    const gs = galeShapley(instance).pairs;
    expect(gs.get('a')).toBe('x');
    expect(gs.get('b')).toBe('y');

    // Swapping roles yields the receiver-optimal matching: a-y, b-x.
    const receiverOptimal = galeShapley({
      proposers: instance.receivers,
      receivers: instance.proposers,
      proposerPrefs: instance.receiverPrefs,
      receiverPrefs: instance.proposerPrefs,
    }).pairs;
    expect(receiverOptimal.get('x')).toBe('b');
    expect(receiverOptimal.get('y')).toBe('a');

    // Receiver x prefers b (rank 0) to a (rank 1).
    const receiverRanks = rankMap(instance.receiverPrefs.get('x')!);
    expect(receiverRanks.get('b')).toBe(0);
    expect(receiverRanks.get('a')).toBe(1);
  });
});
