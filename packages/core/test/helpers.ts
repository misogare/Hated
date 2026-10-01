import type { PreferenceWeights, Profile, TargetedTrait } from '../src/types.js';
import type { LatticeInput } from '../src/gs/rotations.js';
import { createRng } from '../src/util/random.js';

export interface ProfileOptions {
  id: string;
  gender?: string;
  seeking?: string[];
  traits?: Record<string, number>;
  desired?: Record<string, TargetedTrait>;
  weights?: PreferenceWeights;
  blocked?: string[];
}

export function profile(options: ProfileOptions): Profile {
  return {
    id: options.id,
    gender: options.gender ?? 'man',
    seeking: options.seeking ?? [],
    traits: options.traits ?? {},
    desired: options.desired ?? {},
    ...(options.weights !== undefined ? { weights: options.weights } : {}),
    ...(options.blocked !== undefined ? { blocked: options.blocked } : {}),
  };
}

export interface RandomInstance extends LatticeInput {
  proposers: string[];
  receivers: string[];
}

/**
 * A small random bipartite instance with possibly-incomplete preference lists.
 * Deterministic in `seed`, so a failing fast-check counterexample can be replayed.
 */
export function buildRandomInstance(
  seed: number,
  proposerCount: number,
  receiverCount: number,
): RandomInstance {
  const rng = createRng(seed >>> 0);
  const proposers = Array.from({ length: proposerCount }, (_, i) => `p${i}`);
  const receivers = Array.from({ length: receiverCount }, (_, i) => `r${i}`);

  const proposerPrefs = new Map<string, string[]>();
  for (const proposer of proposers) proposerPrefs.set(proposer, shuffledSubset(rng, receivers));

  const receiverPrefs = new Map<string, string[]>();
  for (const receiver of receivers) receiverPrefs.set(receiver, shuffledSubset(rng, proposers));

  return { proposers, receivers, proposerPrefs, receiverPrefs };
}

function shuffledSubset(rng: ReturnType<typeof createRng>, items: readonly string[]): string[] {
  const copy = [...items];
  for (let i = copy.length - 1; i > 0; i--) {
    const j = rng.int(i + 1);
    const temp = copy[i]!;
    copy[i] = copy[j]!;
    copy[j] = temp;
  }
  const keep = rng.int(copy.length + 1);
  return copy.slice(0, keep);
}
