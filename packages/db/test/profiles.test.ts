import { describe, expect, it } from 'vitest';

import { ageOn, validateProfileInput, type ProfileInput } from '../src/profiles.js';

const NOW = new Date('2026-10-05T12:00:00Z');

const VALID: ProfileInput = {
  displayName: 'Sam',
  birthDate: new Date('2003-04-20'),
  gender: 'woman',
  seeking: ['man'],
};

describe('ageOn', () => {
  it('counts whole years by calendar date', () => {
    expect(ageOn(new Date('2003-04-20'), NOW)).toBe(23);
    expect(ageOn(new Date('2003-10-05'), NOW)).toBe(23);
    expect(ageOn(new Date('2003-10-06'), NOW)).toBe(22);
  });
});

describe('validateProfileInput', () => {
  it('accepts a complete profile, including one open to everyone', () => {
    expect(validateProfileInput(VALID, NOW)).toEqual([]);
    expect(validateProfileInput({ ...VALID, seeking: [] }, NOW)).toEqual([]);
  });

  it('turns away anyone under 18, from their birthday on', () => {
    expect(validateProfileInput({ ...VALID, birthDate: new Date('2008-10-06') }, NOW)).toEqual([
      'You need to be 18 or over to use HateD.',
    ]);
    expect(validateProfileInput({ ...VALID, birthDate: new Date('2008-10-05') }, NOW)).toEqual([]);
  });

  it('lists every problem at once', () => {
    const problems = validateProfileInput(
      { displayName: '  ', birthDate: new Date('not a date'), gender: '', seeking: [''] },
      NOW,
    );

    expect(problems).toEqual([
      'Add your first name.',
      'Add your birthday.',
      'Choose how you identify.',
      'Choose who you are open to meeting.',
    ]);
  });

  it('rejects an implausible birthday and an overlong name', () => {
    expect(validateProfileInput({ ...VALID, birthDate: new Date('1890-01-01') }, NOW)).toEqual(['Check your birthday.']);
    expect(validateProfileInput({ ...VALID, displayName: 'x'.repeat(41) }, NOW)).toEqual([
      'Keep your name under 40 characters.',
    ]);
  });
});
