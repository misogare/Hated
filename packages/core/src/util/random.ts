/**
 * Deterministic PRNG. Simulations and randomized searches must be reproducible:
 * if a match round produces a bad outcome we need to be able to replay the exact
 * population that produced it.
 */
export interface Rng {
  /** Uniform in [0, 1). */
  next(): number;
  /** Uniform integer in [0, maxExclusive). */
  int(maxExclusive: number): number;
  /** Uniform element of a non-empty array. */
  pick<T>(items: readonly T[]): T;
}

/** mulberry32 - small, fast, and good enough for simulation work. */
export function createRng(seed: number): Rng {
  let state = seed >>> 0;

  const next = (): number => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };

  return {
    next,
    int(maxExclusive: number): number {
      return Math.floor(next() * maxExclusive);
    },
    pick<T>(items: readonly T[]): T {
      if (items.length === 0) throw new Error('pick() called on an empty array');
      return items[Math.floor(next() * items.length)] as T;
    },
  };
}

/** Approximate standard normal via Box-Muller, for synthetic trait generation. */
export function gaussian(rng: Rng): number {
  const u = Math.max(rng.next(), Number.EPSILON);
  const v = rng.next();
  return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v);
}
