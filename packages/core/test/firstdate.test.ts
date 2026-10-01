import { describe, expect, it } from 'vitest';
import fc from 'fast-check';
import {
  DEFAULT_FIRSTDATE_CONFIG,
  buildPreferenceLists,
  desireTowards,
  isMutuallyAcceptable,
  isOpenTo,
  resolveWeights,
  scorePair,
  scoreTowards,
  traitSimilarity,
} from '../src/firstdate/index.js';
import { profile } from './helpers.js';

describe('openness and mutual acceptability', () => {
  it('treats an empty seeking list as open to everyone', () => {
    const anyone = profile({ id: 'a', gender: 'nonbinary', seeking: [] });
    expect(isOpenTo(anyone, 'man')).toBe(true);
    expect(isOpenTo(anyone, 'woman')).toBe(true);
    expect(isOpenTo(anyone, 'nonbinary')).toBe(true);
  });

  it('rejects pairs where either side is not open to the other', () => {
    const straightMan = profile({ id: 'm', gender: 'man', seeking: ['woman'] });
    const straightWoman = profile({ id: 'w', gender: 'woman', seeking: ['man'] });
    expect(isMutuallyAcceptable(straightMan, straightWoman)).toBe(true);
    expect(isMutuallyAcceptable(straightWoman, straightMan)).toBe(true);

    const gayMan = profile({ id: 'g', gender: 'man', seeking: ['man'] });
    expect(isMutuallyAcceptable(straightMan, gayMan)).toBe(false);
  });

  it('never pairs someone with themselves', () => {
    const person = profile({ id: 'x', seeking: [] });
    expect(isMutuallyAcceptable(person, person)).toBe(false);
  });

  it('treats blocks symmetrically', () => {
    const a = profile({ id: 'a', seeking: [], blocked: ['b'] });
    const b = profile({ id: 'b', seeking: [] });
    expect(isMutuallyAcceptable(a, b)).toBe(false);
    expect(isMutuallyAcceptable(b, a)).toBe(false);
  });
});

describe('scorePair', () => {
  it('is symmetric', () => {
    const a = profile({
      id: 'a',
      gender: 'man',
      seeking: ['woman'],
      traits: { t0: 0.8, t1: 0.2 },
      desired: { t0: { target: 0.9, weight: 0.7 } },
    });
    const b = profile({
      id: 'b',
      gender: 'woman',
      seeking: ['man'],
      traits: { t0: 0.7, t1: 0.3 },
      desired: { t1: { target: 0.4, weight: 0.5 } },
    });
    expect(scorePair(a, b)).toBeCloseTo(scorePair(b, a), 12);
  });

  it('returns zero for unacceptable pairs', () => {
    const a = profile({ id: 'a', gender: 'man', seeking: ['man'] });
    const b = profile({ id: 'b', gender: 'woman', seeking: ['man'] });
    expect(scorePair(a, b)).toBe(0);
  });

  it('rates an aligned pair above a mismatched one', () => {
    const viewer = profile({
      id: 'v',
      gender: 'man',
      seeking: ['woman'],
      traits: { t0: 0.9, t1: 0.9 },
      desired: { t0: { target: 0.9, weight: 1 }, t1: { target: 0.9, weight: 1 } },
    });
    const aligned = profile({
      id: 'aligned',
      gender: 'woman',
      seeking: ['man'],
      traits: { t0: 0.9, t1: 0.9 },
      desired: { t0: { target: 0.9, weight: 1 } },
    });
    const mismatched = profile({
      id: 'mismatched',
      gender: 'woman',
      seeking: ['man'],
      traits: { t0: 0.1, t1: 0.1 },
      desired: { t0: { target: 0.9, weight: 1 } },
    });
    expect(scorePair(viewer, aligned)).toBeGreaterThan(scorePair(viewer, mismatched));
  });
});

describe('viewer-personal scoring', () => {
  const viewer = profile({
    id: 'v',
    gender: 'man',
    seeking: ['woman'],
    traits: { t0: 0 },
    desired: { t0: { target: 1, weight: 1 } }, // wants a t0 of 1, but has 0
  });
  const candidate = profile({
    id: 'c',
    gender: 'woman',
    seeking: ['man'],
    traits: { t0: 1 },
    desired: { t0: { target: 1, weight: 1 } }, // wants a t0 of 1, gets 0
  });

  it('is directional when the two directions are weighted differently', () => {
    // v likes c strongly (desire 1, reciprocity 0); c likes v not at all.
    expect(scoreTowards(viewer, candidate)).toBeGreaterThan(scoreTowards(candidate, viewer));
  });

  it('becomes symmetric when desire and reciprocity carry equal weight', () => {
    const config = { ...DEFAULT_FIRSTDATE_CONFIG, desireWeight: 0.35, reciprocityWeight: 0.35 };
    expect(scoreTowards(viewer, candidate, config)).toBeCloseTo(
      scoreTowards(candidate, viewer, config),
      12,
    );
  });

  it('uses a profile set of weights when present', () => {
    const reciprocityOnly = profile({
      ...viewer,
      id: 'w',
      weights: { similarityWeight: 0, desireWeight: 0, reciprocityWeight: 1 },
    });
    expect(resolveWeights(reciprocityOnly).reciprocityWeight).toBe(1);
    // With only reciprocity weighted, the score is exactly how much the
    // candidate likes them back (candidate wants a t0 of 1, viewer has 0).
    expect(scoreTowards(reciprocityOnly, candidate)).toBeCloseTo(
      desireTowards(candidate, reciprocityOnly),
      12,
    );
  });

  it('scorePair is the symmetric average of the two directions', () => {
    expect(scorePair(viewer, candidate)).toBeCloseTo(
      (scoreTowards(viewer, candidate) + scoreTowards(candidate, viewer)) / 2,
      12,
    );
  });
});

describe('traitSimilarity', () => {
  it('is null when there is no shared trait', () => {
    const a = profile({ id: 'a', traits: { t0: 0.5 } });
    const b = profile({ id: 'b', traits: { t1: 0.5 } });
    expect(traitSimilarity(a, b)).toBeNull();
  });

  it('is ~1 for identical trait vectors and ~0 for orthogonal ones', () => {
    const a = profile({ id: 'a', traits: { t0: 0.4, t1: 0.7 } });
    const identical = profile({ id: 'b', traits: { t0: 0.4, t1: 0.7 } });
    const orthogonal = profile({ id: 'c', traits: { t0: 1, t1: 0 } });
    expect(traitSimilarity(a, identical)).toBeCloseTo(1, 12);
    // a . c = 0.4, |a| = sqrt(0.16+0.49), |c| = 1
    expect(traitSimilarity(a, orthogonal)).toBeCloseTo(0.4 / Math.sqrt(0.65), 12);
  });
});

describe('viewer-personal preference lists', () => {
  it('ranks candidates by the viewer\'s own weights', () => {
    const base = { id: 'a', gender: 'man', seeking: ['woman'], traits: { t0: 1, t1: 0 }, desired: { t0: { target: 0.5, weight: 1 } } };
    const b = profile({ id: 'b', gender: 'woman', seeking: ['man'], traits: { t0: 1, t1: 0 } });
    const c = profile({ id: 'c', gender: 'woman', seeking: ['man'], traits: { t0: 0.5, t1: 0.5 } });

    // b resembles a more (similarity 1 vs ~0.71); c matches a's desire better
    // (closeness 1 vs 0.5). The viewer's weights decide which wins.
    const similarityViewer = profile({
      ...base,
      weights: { similarityWeight: 1, desireWeight: 0, reciprocityWeight: 0 },
    });
    const desireViewer = profile({
      ...base,
      weights: { similarityWeight: 0, desireWeight: 1, reciprocityWeight: 0 },
    });

    const bySimilarity = buildPreferenceLists([similarityViewer, b, c]);
    const byDesire = buildPreferenceLists([desireViewer, b, c]);

    expect(bySimilarity.get('a')).toEqual(['b', 'c']);
    expect(byDesire.get('a')).toEqual(['c', 'b']);
  });
});

describe('buildPreferenceLists', () => {
  it('drops candidates below minScore and truncates to topK', () => {
    const profiles = [
      profile({ id: 'a', gender: 'man', seeking: ['woman'], traits: { t0: 1 }, desired: { t0: { target: 1, weight: 1 } } }),
      profile({ id: 'w1', gender: 'woman', seeking: ['man'], traits: { t0: 1 }, desired: { t0: { target: 1, weight: 1 } } }),
      profile({ id: 'w2', gender: 'woman', seeking: ['man'], traits: { t0: 1 }, desired: { t0: { target: 1, weight: 1 } } }),
      profile({ id: 'w3', gender: 'woman', seeking: ['man'], traits: { t0: 1 }, desired: { t0: { target: 1, weight: 1 } } }),
    ];

    const lists = buildPreferenceLists(profiles, { ...DEFAULT_FIRSTDATE_CONFIG, minScore: 0, topK: 2 });
    expect(lists.get('a')).toHaveLength(2);
    expect(lists.get('a')).toEqual(['w1', 'w2']); // deterministic tie-break by id
  });

  it('is deterministic across runs', () => {
    const profiles = [
      profile({ id: 'a', gender: 'man', seeking: ['woman'], traits: { t0: 0.5 } }),
      profile({ id: 'b', gender: 'woman', seeking: ['man'], traits: { t0: 0.5 } }),
      profile({ id: 'c', gender: 'woman', seeking: ['man'], traits: { t0: 0.5 } }),
    ];
    const first = JSON.stringify([...buildPreferenceLists(profiles)].sort());
    const second = JSON.stringify([...buildPreferenceLists(profiles)].sort());
    expect(first).toBe(second);
  });

  it('only lists mutually acceptable candidates', () => {
    const profiles = [
      profile({ id: 'a', gender: 'man', seeking: ['man'] }),
      profile({ id: 'b', gender: 'woman', seeking: ['man'] }),
      profile({ id: 'c', gender: 'man', seeking: ['man'] }),
    ];
    const lists = buildPreferenceLists(profiles, { ...DEFAULT_FIRSTDATE_CONFIG, minScore: 0 });
    expect(lists.get('a')).toEqual(['c']);
  });
});

describe('scorePair property', () => {
  it('always stays within [0, 1]', () => {
    fc.assert(
      fc.property(
        fc.float({ min: 0, max: 1, noNaN: true }),
        fc.float({ min: 0, max: 1, noNaN: true }),
        (x, y) => {
          const a = profile({
            id: 'a',
            gender: 'man',
            seeking: ['woman'],
            traits: { t0: x, t1: 1 - x },
            desired: { t0: { target: y, weight: 1 } },
          });
          const b = profile({
            id: 'b',
            gender: 'woman',
            seeking: ['man'],
            traits: { t0: y, t1: 1 - y },
            desired: { t1: { target: x, weight: 1 } },
          });
          const score = scorePair(a, b);
          return score >= 0 && score <= 1;
        },
      ),
    );
  });
});
