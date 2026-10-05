/**
 * Runs each weekly round when its slot arrives, inside the API process.
 *
 * At every slot it calls `run(slot)`, which matches the active population and
 * publishes the result. If the server was down at a slot, a restart within
 * `catchUpMs` runs that slot late rather than skipping a week. Running a slot
 * is idempotent in the database (one round per slot), so several API servers
 * can all run this scheduler safely: one of them wins each slot.
 */

import type { ScheduledRoundResult } from '@hated/db';

import { nextRoundAt, previousRoundAt, type RoundSchedule } from './schedule.js';

export interface RoundSchedulerOptions {
  schedule: RoundSchedule;
  run(slot: Date): Promise<ScheduledRoundResult>;
  /** How long after a slot a starting server still runs it. Default 12 hours. */
  catchUpMs?: number;
  now?: () => Date;
  log?: (line: string) => void;
}

export interface RoundScheduler {
  stop(): void;
}

const DEFAULT_CATCH_UP_MS = 12 * 60 * 60 * 1000;
/** setTimeout's ceiling (about 24.8 days); longer waits are taken in steps. */
const MAX_TIMEOUT_MS = 2_147_483_647;

export function startRoundScheduler(options: RoundSchedulerOptions): RoundScheduler {
  const now = options.now ?? (() => new Date());
  const log = options.log ?? ((line: string) => console.log(line));
  const catchUpMs = options.catchUpMs ?? DEFAULT_CATCH_UP_MS;
  let timer: ReturnType<typeof setTimeout> | undefined;
  let stopped = false;

  async function runSlot(slot: Date): Promise<void> {
    const label = slot.toISOString();
    try {
      const result = await options.run(slot);
      log(
        result.ran
          ? `round ${label}: matched ${result.matched} of ${result.population} people (round ${result.roundId})`
          : `round ${label}: skipped, ${result.reason}`,
      );
    } catch (error) {
      log(`round ${label}: failed, ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  /** Wait for the first slot after `after`, run it, then wait for the next. */
  function waitForSlotAfter(after: Date): void {
    if (stopped) return;
    const slot = nextRoundAt(after, options.schedule);
    const wake = (): void => {
      if (stopped) return;
      if (now().getTime() < slot.getTime()) {
        // Woke early (a long wait taken in steps, or the clock moved): keep waiting.
        timer = setTimeout(wake, Math.min(slot.getTime() - now().getTime(), MAX_TIMEOUT_MS));
        return;
      }
      void runSlot(slot).then(() => waitForSlotAfter(slot));
    };
    timer = setTimeout(wake, Math.min(Math.max(0, slot.getTime() - now().getTime()), MAX_TIMEOUT_MS));
  }

  const started = now();
  const missed = previousRoundAt(started, options.schedule);
  const owed = started.getTime() - missed.getTime() <= catchUpMs;
  void (owed ? runSlot(missed) : Promise.resolve()).then(() => waitForSlotAfter(started));

  return {
    stop() {
      stopped = true;
      if (timer !== undefined) clearTimeout(timer);
    },
  };
}
