import { describe, expect, it } from 'vitest';

import { explainMatch, type TraitSnapshot } from '../src/results.js';

function person(traits: Record<string, number>, desires: TraitSnapshot['desires'] = {}): TraitSnapshot {
  return { traits, desires };
}

describe('explainMatch', () => {
  it('names shared traits by how high the pair sits', () => {
    const reasons = explainMatch(person({ humor: 0.9, lifestyle: 0.1 }), person({ humor: 0.85, lifestyle: 0.2 }));

    expect(reasons).toContain('You both lead with humor');
    expect(reasons).toContain("You're both happiest at home");
  });

  it('puts a desire the partner meets ahead of similarities', () => {
    const viewer = person({ humor: 0.9, ambition: 0.2 }, { ambition: { target: 0.8, weight: 1 } });
    const partner = person({ humor: 0.88, ambition: 0.75 });

    expect(explainMatch(viewer, partner)[0]).toBe('Just as driven as you hoped');
  });

  it('says one thing per trait', () => {
    const viewer = person({ ambition: 0.8 }, { ambition: { target: 0.8, weight: 1 } });

    expect(explainMatch(viewer, person({ ambition: 0.8 }))).toEqual(['Just as driven as you hoped']);
  });

  it('ignores traits that are far apart, unknown, or not cared about', () => {
    const viewer = person(
      { humor: 0.1, mystery: 0.5 },
      { openness: { target: 0.9, weight: 0 }, humor: { target: 0.9, weight: 1 } },
    );
    const partner = person({ humor: 0.6, mystery: 0.5, openness: 0.9 });

    expect(explainMatch(viewer, partner)).toEqual([]);
  });

  it('gives at most three reasons', () => {
    const traits = { values: 0.5, lifestyle: 0.5, ambition: 0.5, humor: 0.5, openness: 0.5 };

    expect(explainMatch(person(traits), person(traits))).toHaveLength(3);
  });
});
