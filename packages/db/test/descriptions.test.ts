import { describe, expect, it } from 'vitest';

import { describePerson, suggestOpeners } from '../src/descriptions.js';

describe('describePerson', () => {
  it('leads with the most telling traits, then the ideal weekend', () => {
    expect(describePerson({ humor: 0.95, lifestyle: 0.1, ambition: 0.55, values: 0.6, openness: 0.8 }, 'outdoors')).toEqual([
      'Humor comes first',
      'Happiest at home',
      'Always up for something new',
      'Weekends outdoors',
    ]);
  });

  it('uses four traits when there is no weekend answer, and skips traits it has no words for', () => {
    expect(describePerson({ humor: 0.5, lifestyle: 0.45, ambition: 0.2, values: 0.9, openness: 0.4, height: 1 })).toEqual([
      'Values shape everything',
      'Work stays in its place',
      'Open, one step at a time',
      'Half nights in, half out',
    ]);
  });

  it('breaks a tie by trait name, so the same answers always read the same', () => {
    expect(describePerson({ lifestyle: 0.5, humor: 0.5 })).toEqual(['Knows when a joke fits', 'Half nights in, half out']);
  });

  it('says nothing about someone who skipped everything', () => {
    expect(describePerson({}, null)).toEqual([]);
    expect(describePerson({}, 'skydiving')).toEqual([]);
  });
});

describe('suggestOpeners', () => {
  it("starts from the partner's prompts, then what the two share, closest first", () => {
    expect(
      suggestOpeners([{ key: 'perfect-sunday' }], { humor: 0.9, lifestyle: 0.2, openness: 0.5 }, { humor: 0.88, lifestyle: 0.3, openness: 0.95 }),
    ).toEqual([
      'Your perfect Sunday sounds good. What would you add to it?',
      "What's the last thing that made you properly laugh?",
      'Perfect night in: what are we eating and watching?',
    ]);
  });

  it('uses at most two prompts, and falls back to one that always fits', () => {
    expect(suggestOpeners([{ key: 'green-flag' }, { key: 'first-date' }, { key: 'obsessed-with' }], {}, {})).toEqual([
      "Good green flag. What's one you've spotted lately?",
      'Your ideal first date sounds good. What makes it work?',
      'What made you try an app for people who hate dating apps?',
    ]);
    expect(suggestOpeners([], { humor: 0.1 }, { humor: 0.9 })).toEqual(['What made you try an app for people who hate dating apps?']);
  });
});
