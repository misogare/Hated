/**
 * Per-key request limits with sliding windows, kept in memory.
 *
 * Used per client IP on the sign-in routes: the per-address limits in the
 * database stop one inbox from being flooded, these stop one machine from
 * walking through many addresses (each code is a real email from a capped
 * plan) or guessing across many codes at once.
 *
 * In memory means per API process. Behind several servers each enforces its
 * own share, which still bounds abuse; a shared store would make it exact.
 */

export interface RateLimitRule {
  /** Most requests allowed within the window. */
  limit: number;
  windowMs: number;
}

export type RateLimitResult = { ok: true } | { ok: false; retryAfterMs: number };

export interface RateLimiter {
  /** Count one request for `key`, unless it is over a limit. */
  check(key: string): RateLimitResult;
}

/** Every rule must pass; a refused request is not counted. */
export function createRateLimiter(rules: readonly RateLimitRule[], now: () => number = Date.now): RateLimiter {
  const longest = Math.max(...rules.map((rule) => rule.windowMs));
  const hits = new Map<string, number[]>();
  let checks = 0;

  function sweep(at: number): void {
    for (const [key, times] of hits) {
      if (times.length === 0 || times[times.length - 1]! <= at - longest) hits.delete(key);
    }
  }

  return {
    check(key) {
      const at = now();
      // Bound memory: every so often forget keys with nothing recent.
      if (++checks % 1000 === 0) sweep(at);

      const times = (hits.get(key) ?? []).filter((time) => time > at - longest);
      let wait = 0;
      for (const rule of rules) {
        const inWindow = times.filter((time) => time > at - rule.windowMs);
        if (inWindow.length >= rule.limit) {
          // Room frees up when the oldest request in this window ages out.
          wait = Math.max(wait, inWindow[inWindow.length - rule.limit]! + rule.windowMs - at);
        }
      }
      if (wait > 0) {
        hits.set(key, times);
        return { ok: false, retryAfterMs: wait };
      }
      times.push(at);
      hits.set(key, times);
      return { ok: true };
    },
  };
}
