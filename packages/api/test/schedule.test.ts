import { describe, expect, it } from 'vitest';

import { nextRoundAt, parseSchedule } from '../src/schedule.js';

const MELBOURNE = parseSchedule('SUN', '20:00', 'Australia/Melbourne');

describe('nextRoundAt', () => {
  it('finds next Sunday 8 pm in Melbourne summer time (UTC+11)', () => {
    // Monday 23:00 AEDT.
    expect(nextRoundAt(new Date('2026-10-05T12:00:00Z'), MELBOURNE).toISOString()).toBe('2026-10-11T09:00:00.000Z');
  });

  it('keeps 8 pm local in winter (UTC+10)', () => {
    expect(nextRoundAt(new Date('2026-07-01T00:00:00Z'), MELBOURNE).toISOString()).toBe('2026-07-05T10:00:00.000Z');
  });

  it('lands on 8 pm on the very day daylight saving starts', () => {
    // Saturday 3 October; clocks go forward early on Sunday 4 October 2026.
    expect(nextRoundAt(new Date('2026-10-03T00:00:00Z'), MELBOURNE).toISOString()).toBe('2026-10-04T09:00:00.000Z');
  });

  it('moves to the following week once the slot has passed', () => {
    expect(nextRoundAt(new Date('2026-10-11T09:00:00Z'), MELBOURNE).toISOString()).toBe('2026-10-18T09:00:00.000Z');
  });

  it('can be later the same day', () => {
    const wednesday = parseSchedule('wed', '12:30', 'UTC');
    expect(nextRoundAt(new Date('2026-10-07T12:00:00Z'), wednesday).toISOString()).toBe('2026-10-07T12:30:00.000Z');
  });
});

describe('parseSchedule', () => {
  it('reads day names loosely and times strictly', () => {
    expect(parseSchedule('Sunday', '8:05', 'UTC')).toEqual({ weekday: 0, hour: 8, minute: 5, timeZone: 'UTC' });
    expect(() => parseSchedule('Funday', '20:00', 'UTC')).toThrow(/ROUND_DAY/);
    expect(() => parseSchedule('SUN', '25:00', 'UTC')).toThrow(/ROUND_TIME/);
    expect(() => parseSchedule('SUN', '8pm', 'UTC')).toThrow(/ROUND_TIME/);
    expect(() => parseSchedule('SUN', '20:00', 'Mars/Olympus')).toThrow(/ROUND_TIMEZONE/);
  });
});
