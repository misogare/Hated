import { describe, expect, it } from 'vitest';
import { buildCompatibilityGraph, partitionSides } from '../src/partition/index.js';
import { profile } from './helpers.js';

describe('buildCompatibilityGraph', () => {
  it('counts each mutually acceptable pair once', () => {
    const profiles = [
      profile({ id: 'a', gender: 'man', seeking: ['woman'] }),
      profile({ id: 'b', gender: 'woman', seeking: ['man'] }),
      profile({ id: 'c', gender: 'man', seeking: ['man'] }),
    ];
    const graph = buildCompatibilityGraph(profiles);
    expect(graph.totalPairs).toBe(1); // only a-b
  });
});

describe('partitionSides', () => {
  it('puts every compatible pair on opposite sides when a clean split exists', () => {
    const men = Array.from({ length: 6 }, (_, i) =>
      profile({ id: `m${i}`, gender: 'man', seeking: ['woman'] }),
    );
    const women = Array.from({ length: 6 }, (_, i) =>
      profile({ id: `w${i}`, gender: 'woman', seeking: ['man'] }),
    );
    const result = partitionSides([...men, ...women]);

    const sideOf = new Map<string, 'A' | 'B'>();
    for (const id of result.sideA) sideOf.set(id, 'A');
    for (const id of result.sideB) sideOf.set(id, 'B');

    expect(result.totalCompatiblePairs).toBe(36);
    expect(result.wastedPairs).toBe(0);
    expect(result.matchablePairs).toBe(36);

    for (let i = 0; i < 6; i++) {
      for (let j = 0; j < 6; j++) {
        expect(sideOf.get(`m${i}`)).not.toBe(sideOf.get(`w${j}`));
      }
    }
  });

  it('handles bisexual users by placing them where their edges are usable', () => {
    const profiles = [
      profile({ id: 'straightMan', gender: 'man', seeking: ['woman'] }),
      profile({ id: 'straightWoman', gender: 'woman', seeking: ['man'] }),
      profile({ id: 'biWoman', gender: 'woman', seeking: ['man', 'woman'] }),
      profile({ id: 'lesbian', gender: 'woman', seeking: ['woman'] }),
      profile({ id: 'gayMan', gender: 'man', seeking: ['man'] }),
    ];
    const result = partitionSides(profiles);
    // A partition exists that strands no compatible pair on the same side.
    expect(result.wastedPairs).toBe(0);
    expect(result.matchablePairs).toBe(result.totalCompatiblePairs);
  });

  it('is deterministic', () => {
    const profiles = Array.from({ length: 20 }, (_, i) =>
      profile({
        id: `u${i}`,
        gender: i % 3 === 0 ? 'man' : i % 3 === 1 ? 'woman' : 'nonbinary',
        seeking: i % 3 === 0 ? ['woman'] : i % 3 === 1 ? ['man'] : [],
      }),
    );
    const a = partitionSides(profiles);
    const b = partitionSides(profiles);
    expect(a.sideA).toEqual(b.sideA);
    expect(a.sideB).toEqual(b.sideB);
    expect(a.wastedPairs).toBe(b.wastedPairs);
  });

  it('reports a balanced split for a symmetric pool', () => {
    const profiles = Array.from({ length: 40 }, (_, i) =>
      profile({ id: `u${i}`, gender: i % 2 === 0 ? 'man' : 'woman', seeking: [] }),
    );
    const result = partitionSides(profiles, { balanceWeight: 0.01 });
    expect(Math.abs(result.balance)).toBeLessThanOrEqual(2);
    expect(result.sideA.length + result.sideB.length).toBe(40);
  });

  it('returns an empty partition for an empty pool', () => {
    const result = partitionSides([]);
    expect(result.sideA).toEqual([]);
    expect(result.sideB).toEqual([]);
    expect(result.totalCompatiblePairs).toBe(0);
  });
});
