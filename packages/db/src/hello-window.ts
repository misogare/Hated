/**
 * The window to say hello. Once a round is published, the two people in each
 * match have this long to both say hello. A match that isn't mutual by then
 * closes: no more hellos, so no conversation. One that became mutual in time
 * stays open.
 *
 * Closing reads the same to both people ("the time to say hello is up"), so a
 * person who never said hello doesn't learn whether the other one did.
 */

/** 24 hours. The API can choose another length (HELLO_WINDOW_HOURS), e.g. minutes for trying it out. */
export const HELLO_WINDOW_MS = 24 * 60 * 60 * 1000;

export interface HelloWindowOptions {
  now?: Date;
  /** How long people have to say hello. Default 24 hours. */
  helloWindowMs?: number;
}

/**
 * How long before the window closes a reminder goes to whoever hasn't said
 * hello: 4 hours, or a quarter of a shorter window (minutes, when trying it out).
 */
export function reminderLeadMs(windowMs: number = HELLO_WINDOW_MS): number {
  return Math.min(4 * 60 * 60 * 1000, windowMs / 4);
}

/** When the hello window closes for a round's matches: its publication plus the window. */
export function helloDeadline(round: { startedAt: Date; completedAt: Date | null }, windowMs: number = HELLO_WINDOW_MS): Date {
  return new Date((round.completedAt ?? round.startedAt).getTime() + windowMs);
}

/** The window has closed and the two never both said hello. */
export function helloExpired(deadline: Date, mutual: boolean, now: Date): boolean {
  return !mutual && now.getTime() > deadline.getTime();
}
