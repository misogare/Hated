import { isMutuallyAcceptable } from '@hated/core';
import { describe, expect, it } from 'vitest';

import {
  toEngineProfile,
  toEngineProfiles,
  type ProfileWithRelations,
} from '../src/mapper.js';

/** A minimal row with everything empty; override what a test cares about. */
function row(overrides: Partial<ProfileWithRelations> = {}): ProfileWithRelations {
  return {
    id: 'p1',
    genderId: 'woman',
    similarityWeight: null,
    desireWeight: null,
    reciprocityWeight: null,
    seeking: [],
    traits: [],
    desires: [],
    blocksMade: [],
    blocksTargetingMe: [],
    ...overrides,
  };
}

describe('toEngineProfile', () => {
  it('maps identity fields and treats gender as an opaque tag', () => {
    const profile = toEngineProfile(row({ id: 'u42', genderId: 'nonbinary' }));
    expect(profile.id).toBe('u42');
    expect(profile.gender).toBe('nonbinary');
  });

  it('flattens trait rows into a key/value record', () => {
    const profile = toEngineProfile(
      row({
        traits: [
          { key: 'openness', value: 0.2 },
          { key: 'humor', value: 0.9 },
        ],
      }),
    );
    expect(profile.traits).toEqual({ openness: 0.2, humor: 0.9 });
  });

  it('flattens desire rows into TargetedTrait entries', () => {
    const profile = toEngineProfile(
      row({ desires: [{ key: 'height', target: 0.7, weight: 0.3 }] }),
    );
    expect(profile.desired).toEqual({ height: { target: 0.7, weight: 0.3 } });
  });

  it('maps seeking rows to genders, and empty seeking stays empty (open to all)', () => {
    const seeking = toEngineProfile(
      row({ seeking: [{ genderId: 'man' }, { genderId: 'woman' }] }),
    );
    expect(seeking.seeking).toEqual(['man', 'woman']);

    const open = toEngineProfile(row());
    expect(open.seeking).toEqual([]);
  });

  it('emits weights only when all three columns are set', () => {
    const complete = toEngineProfile(
      row({ similarityWeight: 0.2, desireWeight: 0.5, reciprocityWeight: 0 }),
    );
    expect(complete.weights).toEqual({
      similarityWeight: 0.2,
      desireWeight: 0.5,
      reciprocityWeight: 0,
    });
  });

  it('treats a partially-set weight triple as unset', () => {
    const partial = toEngineProfile(row({ similarityWeight: 0.2 }));
    expect(partial.weights).toBeUndefined();
    expect('weights' in partial).toBe(false);

    const none = toEngineProfile(row());
    expect('weights' in none).toBe(false);
  });

  it('unions blocks from both directions, deduped and sorted', () => {
    const profile = toEngineProfile(
      row({
        blocksMade: [{ blockedId: 'zoe' }, { blockedId: 'amy' }],
        blocksTargetingMe: [{ blockerId: 'max' }, { blockerId: 'amy' }],
      }),
    );
    expect(profile.blocked).toEqual(['amy', 'max', 'zoe']);
  });

  it('omits blocked entirely when there are no blocks', () => {
    const profile = toEngineProfile(row());
    expect(profile.blocked).toBeUndefined();
    expect('blocked' in profile).toBe(false);
  });
});

describe('toEngineProfiles', () => {
  it('preserves input order', () => {
    const profiles = toEngineProfiles([row({ id: 'b' }), row({ id: 'a' })]);
    expect(profiles.map((profile) => profile.id)).toEqual(['b', 'a']);
  });
});

describe('mapped profiles work with the engine', () => {
  it('accepts complementary orientations and treats one-sided blocks as mutual', () => {
    const man = row({ id: 'a', genderId: 'man', seeking: [{ genderId: 'woman' }] });
    const woman = row({ id: 'b', genderId: 'woman', seeking: [{ genderId: 'man' }] });

    expect(isMutuallyAcceptable(toEngineProfile(man), toEngineProfile(woman))).toBe(true);

    // The block is stored on one side only, but the mapper unions it, so both
    // directions of the pair become unacceptable.
    const manBlocked = toEngineProfile(
      row({ ...man, blocksMade: [{ blockedId: 'b' }] }),
    );
    expect(isMutuallyAcceptable(manBlocked, toEngineProfile(woman))).toBe(false);

    const womanBlocked = toEngineProfile(
      row({ ...woman, blocksMade: [{ blockedId: 'a' }] }),
    );
    expect(isMutuallyAcceptable(toEngineProfile(man), womanBlocked)).toBe(false);
  });

  it('treats empty seeking as open to everyone', () => {
    const open = toEngineProfile(row({ id: 'a', genderId: 'man' }));
    const other = toEngineProfile(row({ id: 'b', genderId: 'woman' }));
    expect(isMutuallyAcceptable(open, other)).toBe(true);
  });
});
