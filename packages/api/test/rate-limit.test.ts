import { describe, expect, it } from 'vitest';

import { createRateLimiter } from '../src/rate-limit.js';

describe('createRateLimiter', () => {
  it('allows up to the limit in a window, then says when to retry', () => {
    let now = 0;
    const limiter = createRateLimiter([{ limit: 3, windowMs: 60_000 }], () => now);

    expect([limiter.check('ip'), limiter.check('ip'), limiter.check('ip')].every((r) => r.ok)).toBe(true);
    now = 10_000;
    expect(limiter.check('ip')).toEqual({ ok: false, retryAfterMs: 50_000 });

    now = 60_001;
    expect(limiter.check('ip')).toEqual({ ok: true });
  });

  it('keeps keys apart', () => {
    const limiter = createRateLimiter([{ limit: 1, windowMs: 60_000 }], () => 0);
    expect(limiter.check('a').ok).toBe(true);
    expect(limiter.check('b').ok).toBe(true);
    expect(limiter.check('a').ok).toBe(false);
  });

  it('applies every rule, reporting the longest wait', () => {
    let now = 0;
    const limiter = createRateLimiter(
      [
        { limit: 2, windowMs: 1_000 },
        { limit: 3, windowMs: 60_000 },
      ],
      () => now,
    );

    limiter.check('ip');
    limiter.check('ip');
    expect(limiter.check('ip')).toEqual({ ok: false, retryAfterMs: 1_000 });
    now = 1_500;
    expect(limiter.check('ip').ok).toBe(true);
    now = 3_000;
    expect(limiter.check('ip')).toEqual({ ok: false, retryAfterMs: 57_000 });
  });

  it('does not count refused requests', () => {
    let now = 0;
    const limiter = createRateLimiter([{ limit: 1, windowMs: 10_000 }], () => now);
    limiter.check('ip');
    for (let i = 0; i < 5; i++) limiter.check('ip');
    now = 10_001;
    expect(limiter.check('ip').ok).toBe(true);
  });
});
