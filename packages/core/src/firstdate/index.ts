/**
 * The "FirstDate" layer: turn questionnaire answers into ranked preference lists.
 *
 * Gale-Shapley only *reorders* candidates; it creates no compatibility of its
 * own. Everything that decides whether two people are good for each other
 * happens here, which makes this the part of the product worth tuning.
 *
 * Scoring is viewer-personal: each person ranks candidates by their *own*
 * utility, built from
 *   - similarity   : do they resemble each other (shared values / lifestyle)
 *   - desire       : does the candidate match what this person asked for
 * and optionally
 *   - reciprocity  : how much this person values being wanted back (off by
 *                    default; see below)
 *
 * The two directions are deliberately allowed to disagree. A symmetric pair
 * score makes each side's list a mirror image of the other's, which collapses
 * the stable-matching lattice to a single point and leaves the fairness search
 * nothing to choose between.
 *
 * Reciprocity defaults to zero weight. It is not needed for mutuality: because
 * both sides have incomplete lists and a receiver only accepts a proposal from
 * someone they also list, Gale-Shapley cannot produce a one-sided match. Baking
 * the candidate's desire into the viewer's ranking only correlates the two
 * directions and flattens the lattice.
 *
 * Weights are renormalised over whichever signals actually exist, so a user who
 * skipped the questionnaire degrades to a neutral score instead of a zero one.
 */

import type { FirstDateConfig, GenderId, PreferenceWeights, Profile } from '../types.js';

export const DEFAULT_FIRSTDATE_CONFIG: FirstDateConfig = {
  similarityWeight: 0.3,
  desireWeight: 0.4,
  reciprocityWeight: 0,
  minScore: 0.35,
  topK: 32,
};

function clamp01(value: number): number {
  if (Number.isNaN(value)) return 0;
  if (value < 0) return 0;
  if (value > 1) return 1;
  return value;
}

/** An empty `seeking` list means "open to everyone". */
export function isOpenTo(profile: Profile, gender: GenderId): boolean {
  return profile.seeking.length === 0 || profile.seeking.includes(gender);
}

/**
 * Can these two people be matched at all? Orientation and blocks only.
 * Score thresholds and list truncation are applied later, per direction.
 */
export function isMutuallyAcceptable(a: Profile, b: Profile): boolean {
  if (a.id === b.id) return false;
  if (!isOpenTo(a, b.gender) || !isOpenTo(b, a.gender)) return false;
  if (a.blocked !== undefined && a.blocked.includes(b.id)) return false;
  if (b.blocked !== undefined && b.blocked.includes(a.id)) return false;
  return true;
}

interface Term {
  value: number;
  weight: number;
}

function weightedMean(terms: readonly Term[], fallback: number): number {
  let numerator = 0;
  let denominator = 0;
  for (const term of terms) {
    if (!(term.weight > 0)) continue;
    numerator += clamp01(term.value) * term.weight;
    denominator += term.weight;
  }
  return denominator === 0 ? fallback : numerator / denominator;
}

/** Cosine similarity over traits both users reported. Null when there is no overlap. */
export function traitSimilarity(a: Profile, b: Profile): number | null {
  const shared = Object.keys(a.traits).filter((trait) => trait in b.traits);
  if (shared.length === 0) return null;

  let dot = 0;
  let normA = 0;
  let normB = 0;
  for (const trait of shared) {
    const x = clamp01(a.traits[trait] as number);
    const y = clamp01(b.traits[trait] as number);
    dot += x * y;
    normA += x * x;
    normB += y * y;
  }
  if (normA === 0 || normB === 0) return null;
  return clamp01(dot / Math.sqrt(normA * normB));
}

/**
 * How well `candidate` satisfies what `viewer` said they want.
 * Returns the neutral 0.5 when the viewer stated no usable desires.
 */
export function desireTowards(viewer: Profile, candidate: Profile): number {
  const terms: Term[] = [];
  for (const [trait, want] of Object.entries(viewer.desired)) {
    const actual = candidate.traits[trait];
    if (actual === undefined) continue;
    const closeness = 1 - Math.abs(clamp01(actual) - clamp01(want.target));
    terms.push({ value: closeness, weight: want.weight });
  }
  return weightedMean(terms, 0.5);
}

/**
 * The ranking weights this particular person scores with: their own when set,
 * otherwise the round defaults.
 */
export function resolveWeights(
  profile: Profile,
  config: FirstDateConfig = DEFAULT_FIRSTDATE_CONFIG,
): PreferenceWeights {
  return (
    profile.weights ?? {
      similarityWeight: config.similarityWeight,
      desireWeight: config.desireWeight,
      reciprocityWeight: config.reciprocityWeight,
    }
  );
}

/**
 * How much `viewer` personally likes `candidate`, in [0,1].
 *
 * This is the directional score: the viewer's own weights and stated desires
 * decide the ranking, so `scoreTowards(a, b)` need not equal
 * `scoreTowards(b, a)`. Gale-Shapley consumes each side's own list, and the
 * receiver-acceptance check is what keeps a match mutual - reciprocity does not
 * need to be baked into the score for that.
 */
export function scoreTowards(
  viewer: Profile,
  candidate: Profile,
  config: FirstDateConfig = DEFAULT_FIRSTDATE_CONFIG,
): number {
  if (!isMutuallyAcceptable(viewer, candidate)) return 0;

  const weights = resolveWeights(viewer, config);
  const terms: Term[] = [];
  const similarity = traitSimilarity(viewer, candidate);
  if (similarity !== null) terms.push({ value: similarity, weight: weights.similarityWeight });
  terms.push({ value: desireTowards(viewer, candidate), weight: weights.desireWeight });
  terms.push({ value: desireTowards(candidate, viewer), weight: weights.reciprocityWeight });

  return clamp01(weightedMean(terms, 0.5));
}

/**
 * Symmetric mutual-compatibility helper: the average of the two directional
 * scores. Useful for reporting and thresholds, but preference *lists* must come
 * from `scoreTowards`, since a person ranks candidates by their own view.
 */
export function scorePair(
  a: Profile,
  b: Profile,
  config: FirstDateConfig = DEFAULT_FIRSTDATE_CONFIG,
): number {
  if (!isMutuallyAcceptable(a, b)) return 0;
  return clamp01((scoreTowards(a, b, config) + scoreTowards(b, a, config)) / 2);
}

/**
 * Build each user's ranked list of acceptable partners.
 *
 * Candidates below `minScore` are dropped outright and the rest are truncated
 * to `topK`. Ties break on id so a given population always produces byte-identical
 * lists, which is what makes a match round reproducible after the fact.
 */
export function buildPreferenceLists(
  profiles: readonly Profile[],
  config: FirstDateConfig = DEFAULT_FIRSTDATE_CONFIG,
): Map<string, string[]> {
  const lists = new Map<string, string[]>();

  for (const viewer of profiles) {
    const scored: Array<{ id: string; score: number }> = [];
    for (const candidate of profiles) {
      if (viewer.id === candidate.id) continue;
      if (!isMutuallyAcceptable(viewer, candidate)) continue;
      const score = scoreTowards(viewer, candidate, config);
      if (score < config.minScore) continue;
      scored.push({ id: candidate.id, score });
    }
    scored.sort((x, y) => y.score - x.score || compareIds(x.id, y.id));
    lists.set(
      viewer.id,
      scored.slice(0, Math.max(0, config.topK)).map((entry) => entry.id),
    );
  }

  return lists;
}

/** Deterministic total order over ids, used for every tie-break in the engine. */
export function compareIds(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0;
}

/** Convenience for round metrics: the full scored matrix for acceptable pairs. */
export function buildScoreMatrix(
  profiles: readonly Profile[],
  config: FirstDateConfig = DEFAULT_FIRSTDATE_CONFIG,
): Map<string, Map<string, number>> {
  const matrix = new Map<string, Map<string, number>>();
  for (const a of profiles) {
    const row = new Map<string, number>();
    for (const b of profiles) {
      if (a.id === b.id) continue;
      if (!isMutuallyAcceptable(a, b)) continue;
      row.set(b.id, scoreTowards(a, b, config));
    }
    matrix.set(a.id, row);
  }
  return matrix;
}
