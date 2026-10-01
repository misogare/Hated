/**
 * Core value types for the HateD matching engine.
 *
 * The engine is deliberately gender-agnostic: a gender is an opaque string tag
 * supplied by the caller, so the same engine works under any taxonomy the
 * product settles on. Nothing in here assumes a two-gender world.
 */

export type GenderId = string;

/**
 * How much one person cares about each signal when ranking candidates.
 *
 * These are per-profile on purpose. With everyone using the same weights the
 * two directions of a pair score almost identically, their preference lists
 * become mirror images, and the stable-matching lattice collapses to a single
 * point - which makes the fairness search pointless. Personal weights keep the
 * two sides' rankings genuinely independent.
 */
export interface PreferenceWeights {
  /** Weight on trait similarity: shared values, background, lifestyle. */
  similarityWeight: number;
  /** Weight on how well a candidate satisfies this person's stated desires. */
  desireWeight: number;
  /**
   * Weight this person puts on being wanted back. Off by default; see
   * `FirstDateConfig.reciprocityWeight`.
   */
  reciprocityWeight: number;
}

/** What a user wants a partner to look like on one trait. */
export interface TargetedTrait {
  /** The value the user wants a partner to have for this trait, in [0,1]. */
  target: number;
  /** How much the user cares, in [0,1]. Zero means the trait is ignored. */
  weight: number;
}

export interface Profile {
  id: string;
  gender: GenderId;
  /** Genders this user will accept. An empty array means "open to everyone". */
  seeking: GenderId[];
  /** The user's own trait values, normalised to [0,1] by the caller. */
  traits: Record<string, number>;
  /** What the user wants in a partner. Traits absent here are ignored. */
  desired: Record<string, TargetedTrait>;
  /**
   * Optional per-person ranking weights. When absent the round's
   * `FirstDateConfig` weights are used instead.
   */
  weights?: PreferenceWeights;
  /** Hard exclusions (blocked, reported, already met). Treated as symmetric. */
  blocked?: string[];
}

/**
 * Knobs for the "FirstDate" preference layer. These decide the ranked list
 * that Gale-Shapley consumes; changing them changes who is even reachable.
 */
export interface FirstDateConfig {
  /** Weight on trait similarity: shared values, background, lifestyle. */
  similarityWeight: number;
  /** Weight on how well the candidate satisfies the viewer's stated desires. */
  desireWeight: number;
  /**
   * Weight on the reverse desire (how much the candidate wants the viewer).
   * Defaults to 0. Putting it in the viewer's own ranking makes the two
   * directions nearly mirror images and collapses the stable-matching lattice,
   * leaving the fairness search nothing to choose. Mutuality is already enforced
   * by the two-sided preference lists, so this is an optional product lever, not
   * a correctness requirement.
   */
  reciprocityWeight: number;
  /** Minimum combined score for a candidate to be considered at all. */
  minScore: number;
  /** Maximum preference-list length. Keeps the matching step at O(n * topK). */
  topK: number;
}
