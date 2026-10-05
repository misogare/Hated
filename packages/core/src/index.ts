/**
 * HateD matching engine.
 *
 * One public entry point per stage, so the pieces can be used independently:
 *   FirstDate ranking -> partition -> Gale-Shapley -> fairness search.
 *
 * `runMatchRound` wires them together and is what an API worker should call.
 */

export type {
  FirstDateConfig,
  GenderId,
  PreferenceWeights,
  Profile,
  TargetedTrait,
} from './types.js';

export {
  DEFAULT_FIRSTDATE_CONFIG,
  buildPreferenceLists,
  buildScoreMatrix,
  compareIds,
  desireTowards,
  isMutuallyAcceptable,
  isOpenTo,
  resolveWeights,
  scorePair,
  scoreTowards,
  traitSimilarity,
} from './firstdate/index.js';

export {
  buildCompatibilityGraph,
  partitionSides,
  type CompatibilityGraph,
  type PartitionOptions,
  type PartitionResult,
} from './partition/index.js';

export {
  checkStability,
  galeShapley,
  rankMap,
  type StableMarriageInput,
  type StableMarriageResult,
  type StabilityCheck,
} from './gs/stable-marriage.js';

export {
  applyRotation,
  buildReducedLists,
  enumerateStableMatchings,
  findExposedRotations,
  invertMatching,
  type LatticeInput,
  type ReducedLists,
  type Rotation,
} from './gs/rotations.js';

export {
  evaluateMatching,
  findFairMatching,
  objectiveValue,
  type FairMatcherInput,
  type FairMatcherResult,
  type FairObjective,
  type MatchingEvaluation,
  type MatchingEvaluatorInput,
} from './gs/fair.js';

export { computeSideMetrics, type RoundMetrics, type SideMetrics } from './metrics/index.js';

export {
  runMatchRound,
  type MatchRoundOptions,
  type RoundPair,
  type RoundResult,
} from './round/index.js';

export {
  generatePopulation,
  seekingFor,
  summarizePopulation,
  type Orientation,
  type PopulationSummary,
  type SyntheticOptions,
} from './sim/synthetic.js';

export { createRng, gaussian, type Rng } from './util/random.js';
