import type { ScheduledRoundResult } from '@hated/db';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { startRoundScheduler, type RoundScheduler } from '../src/round-scheduler.js';
import { parseSchedule, previousRoundAt } from '../src/schedule.js';

const SCHEDULE = parseSchedule('SUN', '20:00', 'Australia/Melbourne');
// Sunday 11 October 2026, 20:00 AEDT.
const SLOT = new Date('2026-10-11T09:00:00Z');
const WEEK = 7 * 24 * 60 * 60 * 1000;

describe('previousRoundAt', () => {
  it('is the slot itself at the slot, and last week just before it', () => {
    expect(previousRoundAt(SLOT, SCHEDULE)).toEqual(SLOT);
    expect(previousRoundAt(new Date(SLOT.getTime() - 1), SCHEDULE).toISOString()).toBe('2026-10-04T09:00:00.000Z');
    expect(previousRoundAt(new Date(SLOT.getTime() + 3 * 86_400_000), SCHEDULE)).toEqual(SLOT);
  });
});

describe('startRoundScheduler', () => {
  let scheduler: RoundScheduler | undefined;
  let runs: string[];
  let lines: string[];

  beforeEach(() => {
    vi.useFakeTimers();
    runs = [];
    lines = [];
  });

  afterEach(() => {
    scheduler?.stop();
    vi.useRealTimers();
  });

  function start(at: Date, run?: (slot: Date) => Promise<ScheduledRoundResult>) {
    vi.setSystemTime(at);
    scheduler = startRoundScheduler({
      schedule: SCHEDULE,
      run:
        run ??
        (async (slot) => {
          runs.push(slot.toISOString());
          return { ran: true, roundId: `r${runs.length}`, population: 10, matched: 8 };
        }),
      log: (line) => lines.push(line),
    });
  }

  it('runs the round when the slot arrives, then every week', async () => {
    start(new Date(SLOT.getTime() - 10 * 60_000));
    await vi.advanceTimersByTimeAsync(10 * 60_000 - 1);
    expect(runs).toEqual([]);

    await vi.advanceTimersByTimeAsync(1);
    expect(runs).toEqual([SLOT.toISOString()]);
    expect(lines[0]).toContain('matched 8 of 10');

    await vi.advanceTimersByTimeAsync(WEEK);
    expect(runs).toEqual([SLOT.toISOString(), '2026-10-18T09:00:00.000Z']);
  });

  it('catches up a slot missed while the server was down, within the window', async () => {
    start(new Date(SLOT.getTime() + 60 * 60_000));
    await vi.advanceTimersByTimeAsync(0);
    expect(runs).toEqual([SLOT.toISOString()]);
  });

  it('does not run a slot that is too old to catch up', async () => {
    start(new Date(SLOT.getTime() + 13 * 60 * 60_000));
    await vi.advanceTimersByTimeAsync(0);
    expect(runs).toEqual([]);
  });

  it('keeps going after a failed or skipped round', async () => {
    let calls = 0;
    start(new Date(SLOT.getTime() - 1000), async () => {
      calls++;
      if (calls === 1) throw new Error('database down');
      return { ran: false, reason: 'already-ran' };
    });

    await vi.advanceTimersByTimeAsync(1000);
    await vi.advanceTimersByTimeAsync(WEEK);
    expect(calls).toBe(2);
    expect(lines).toEqual([
      'round 2026-10-11T09:00:00.000Z: failed, database down',
      'round 2026-10-18T09:00:00.000Z: skipped, already-ran',
    ]);
  });

  it('stops', async () => {
    start(new Date(SLOT.getTime() - 1000));
    scheduler!.stop();
    await vi.advanceTimersByTimeAsync(WEEK);
    expect(runs).toEqual([]);
  });
});
