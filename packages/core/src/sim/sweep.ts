/**
 * Parameter sweep over the FirstDate knobs and the population shape.
 *
 * `topK` and `minScore` decide how big and how choosy the preference lists are,
 * and they pull against each other:
 *
 *   - a lower `minScore` (or bigger `topK`) accepts more candidates, so more
 *     people end up matched, but the average match is a worse fit;
 *   - a higher `minScore` (or smaller `topK`) keeps only strong candidates, so
 *     the matches that happen are better, but more people go unmatched.
 *
 * The population parameters change a different thing: how much freedom the
 * fairness search has. More trait clusters make the compatibility graph sparser,
 * and a wider spread of per-person ranking weights makes the two sides' lists
 * less alike. Both fatten the stable-matching lattice, which is what gives the
 * rotation search candidates to choose between. Each cell therefore also reports
 * two cheap lattice measures: how many rotations are exposed at the
 * proposer-optimal matching, and how many rotations a greedy walk applies on its
 * way to the other extreme.
 *
 * There is no single best cell. What a product owner needs is the frontier of
 * settings where you cannot improve one thing without giving up another. Note
 * that the trade-off is not only match rate vs average quality: a bigger pool of
 * options tends to raise match rate and lower average cost while *widening* the
 * gap between the two sides. So the frontier is built over three axes at once:
 * higher match rate, lower mean cost, and a smaller satisfaction gap.
 *
 * Match rate itself is invariant to the fairness objective: by the Rural
 * Hospitals theorem every stable matching matches the same number of people, so
 * the objective moves equitability, not the match rate.
 */

import type { Profile } from '../types.js';
import {
  evaluateMatching,
  objectiveValue,
  type FairObjective,
  type MatchingEvaluatorInput,
} from '../gs/fair.js';
import { partitionSides, type PartitionResult } from '../partition/index.js';
import { runMatchRound, type MatchRoundOptions } from '../round/index.js';
import { galeShapley, type StableMarriageInput } from '../gs/stable-marriage.js';
import { applyRotation, findExposedRotations } from '../gs/rotations.js';
import { generatePopulation, type SyntheticOptions } from './synthetic.js';

const OBJECTIVE_ORDER: FairObjective[] = [
  'egalitarian',
  'min-regret',
  'side-equal',
  'proposer-favored',
  'receiver-favored',
];

/** Default cap on how many stable matchings a lattice sample visits. */
const DEFAULT_LATTICE_SAMPLE = 128;

export interface SweepOptions extends MatchRoundOptions {
  /** List sizes to try. */
  topKValues: readonly number[];
  /** Minimum-score thresholds to try. */
  minScoreValues: readonly number[];
  /**
   * Fairness objectives to try. Defaults to the single `objective` (or
   * `min-regret`). Note that the objective selects *which* stable matching to
   * ship; by the Rural Hospitals theorem every stable matching matches the same
   * number of people, so changing it moves equitability, not the match rate.
   */
  objectives?: readonly FairObjective[];
  /**
   * How many stable matchings to sample per (population, topK, minScore) when
   * measuring an objective's full range. Higher is more accurate and slower.
   */
  latticeSample?: number;
}

export interface LatticeMetrics {
  /** Rotations exposed at the proposer-optimal matching (width of the lattice top). */
  exposedRotations: number;
  /** Rotations a greedy walk applies to a terminal matching (lower bound on lattice depth). */
  latticeDepth: number;
}

export interface SweepCell {
  topK: number;
  minScore: number;
  objective: FairObjective;
  population: number;
  matched: number;
  /** Fraction of people who ended up matched, in [0,1]. */
  matchRate: number;
  /** Fraction of people who got their first choice. */
  firstChoiceRate: number;
  /** Mean normalised rank cost across everyone (0 = first choice, 1 = worst). Lower is better. */
  meanCost: number;
  /** Worst normalised rank cost anyone suffered. Lower is better. */
  worstCost: number;
  /** |sideA mean cost - sideB mean cost|. Lower is a more even outcome. */
  satisfactionGap: number;
  stable: boolean;
  /** Fairness-search gain over plain Gale-Shapley. */
  improvement: number;
  /**
   * |proposerOptimalValue - receiverOptimalValue| under this objective: how far
   * apart the two ends of the lattice are. Near zero means the objective barely
   * moves between the proposer- and receiver-optimal matchings, so the lattice
   * is close to flat and there is little to choose.
   *
   * This is the distance between the two extremes, not the objective's full
   * range: an objective whose optimum sits in the interior of the lattice
   * (egalitarian often does) can post an `improvement` larger than this span.
   */
  latticeSpan: number;
  /**
   * max - min of this objective over the sampled stable matchings. Unlike
   * `latticeSpan`, which only looks at the two extremes, this can capture an
   * optimum that sits in the interior of the lattice (egalitarian often does).
   * It is a lower bound on the true range: the sample is bounded and may not
   * visit every stable matching.
   */
  latticeRange: number;
  /** Lattice size measures; identical across objectives for one setting. */
  lattice: LatticeMetrics;
  /** Present when the sweep varied the population's trait-cluster count. */
  clusterCount?: number;
  /** Present when the sweep varied the population's weight spread. */
  weightSpread?: number;
}

export interface LatticeSample {
  /** Distinct stable matchings reached, proposer-optimal first. */
  matchings: Array<Map<string, string>>;
  /** Rotations exposed at the proposer-optimal matching. */
  exposedRotations: number;
  /** Deepest rotation-walk level reached in the sample. */
  latticeDepth: number;
}

/**
 * Breadth-first sample of the stable-matching lattice from the proposer-optimal
 * matching, capped at `maxMatchings`. Rotations only ever move "down" the
 * lattice (proposers get worse), so following them from the top reaches interior
 * stable matchings as well as the receiver-optimal end - which is what makes an
 * interior optimum visible. Deterministic: the rotation finder returns rotations
 * in a fixed order.
 */
export function sampleLattice(
  input: StableMarriageInput,
  options: { maxMatchings?: number } = {},
): LatticeSample {
  const maxMatchings = Math.max(1, options.maxMatchings ?? DEFAULT_LATTICE_SAMPLE);
  const start = galeShapley(input).pairs;
  const exposedRotations = findExposedRotations(start, input).length;

  const seen = new Set<string>([matchingKey(start)]);
  const matchings: Array<Map<string, string>> = [start];
  const queue: Array<{ matching: Map<string, string>; depth: number }> = [
    { matching: start, depth: 0 },
  ];
  let latticeDepth = 0;
  let head = 0;

  while (head < queue.length && matchings.length < maxMatchings) {
    const { matching, depth } = queue[head++]!;
    for (const rotation of findExposedRotations(matching, input)) {
      if (matchings.length >= maxMatchings) break;
      const next = applyRotation(matching, rotation);
      const key = matchingKey(next);
      if (seen.has(key)) continue;
      seen.add(key);
      matchings.push(next);
      latticeDepth = Math.max(latticeDepth, depth + 1);
      queue.push({ matching: next, depth: depth + 1 });
    }
  }

  return { matchings, exposedRotations, latticeDepth };
}

function matchingKey(matching: ReadonlyMap<string, string>): string {
  return [...matching.entries()]
    .map(([proposer, receiver]) => `${proposer}>${receiver}`)
    .sort()
    .join('|');
}

/**
 * Two cheap lattice measures for one instance. Starts from the proposer-optimal
 * matching regardless of objective, so the value depends only on the population
 * shape and the list parameters, not on which matching gets shipped.
 */
export function latticeMetrics(input: StableMarriageInput): LatticeMetrics {
  const sample = sampleLattice(input);
  return { exposedRotations: sample.exposedRotations, latticeDepth: sample.latticeDepth };
}

export function runSweep(profiles: readonly Profile[], options: SweepOptions): SweepCell[] {
  // The split does not depend on scores, so compute it once for the whole grid.
  const partitionResult: PartitionResult =
    options.partitionResult ?? partitionSides(profiles, options.partition);
  const objectives = options.objectives ?? [options.objective ?? 'min-regret'];

  const cells: SweepCell[] = [];
  for (const topK of options.topKValues) {
    for (const minScore of options.minScoreValues) {
      // The lattice depends only on the lists, which do not depend on the
      // objective, so sample it once per (topK, minScore) and score every
      // objective against the same matchings.
      let sample: LatticeSample | undefined;
      let evaluatorInput: MatchingEvaluatorInput | undefined;

      for (const objective of objectives) {
        const result = runMatchRound(profiles, {
          ...options,
          partitionResult,
          objective,
          firstDate: { ...options.firstDate, topK, minScore },
        });

        if (sample === undefined) {
          evaluatorInput = {
            proposers: partitionResult.sideA,
            receivers: partitionResult.sideB,
            proposerPrefs: result.proposerPrefs,
            receiverPrefs: result.receiverPrefs,
          };
          sample = sampleLattice(
            {
              proposers: partitionResult.sideA,
              receivers: partitionResult.sideB,
              proposerPrefs: result.proposerPrefs,
              receiverPrefs: result.receiverPrefs,
            },
            { maxMatchings: options.latticeSample },
          );
        }

        const objectiveValues = sample.matchings.map((matching) =>
          objectiveValue(objective, evaluateMatching(evaluatorInput!, matching)),
        );

        cells.push({
          topK,
          minScore,
          objective,
          population: result.metrics.population,
          matched: result.metrics.matched,
          matchRate: result.metrics.matchRate,
          firstChoiceRate: result.metrics.firstChoiceRate,
          meanCost: result.fair.evaluation.meanCost,
          worstCost: result.fair.evaluation.worstCost,
          satisfactionGap: result.metrics.satisfactionGap,
          stable: result.metrics.stable,
          improvement: result.fair.improvement,
          latticeSpan: Math.abs(
            result.fair.proposerOptimalValue - result.fair.receiverOptimalValue,
          ),
          latticeRange: Math.max(...objectiveValues) - Math.min(...objectiveValues),
          lattice: { exposedRotations: sample.exposedRotations, latticeDepth: sample.latticeDepth },
        });
      }
    }
  }
  return cells;
}

export interface PopulationSweepGrid {
  population: number;
  seed: number;
  /** Trait-cluster counts to try. More clusters means a sparser compatibility graph. */
  clusterCounts: readonly number[];
  /** Weight spreads to try. Wider spread means more independent rankings. */
  weightSpreads: readonly number[];
  /** Extra synthetic options held constant across the grid. */
  populationOptions?: Omit<SyntheticOptions, 'population' | 'seed' | 'clusterCount' | 'weightSpread'>;
}

/**
 * Sweep the population shape as well as the FirstDate knobs. Cells are stamped
 * with the `clusterCount` and `weightSpread` that produced them, so the lattice
 * effect can be summarised per population.
 */
export function runPopulationSweep(
  grid: PopulationSweepGrid,
  options: SweepOptions,
): SweepCell[] {
  const cells: SweepCell[] = [];
  for (const clusterCount of grid.clusterCounts) {
    for (const weightSpread of grid.weightSpreads) {
      const profiles = generatePopulation({
        ...grid.populationOptions,
        population: grid.population,
        seed: grid.seed,
        clusterCount,
        weightSpread,
      });
      for (const cell of runSweep(profiles, options)) {
        cells.push({ ...cell, clusterCount, weightSpread });
      }
    }
  }
  return cells;
}

export interface ObjectiveSummary {
  objective: FairObjective;
  cells: number;
  /** Match rate is identical across objectives; reported so the invariance is visible. */
  meanMatchRate: number;
  meanCost: number;
  meanGap: number;
  worstGap: number;
  /** Mean lattice span under this objective; near zero means a flat lattice. */
  meanSpan: number;
  maxSpan: number;
  /** Mean full lattice range (max - min over sampled stable matchings). */
  meanRange: number;
}

/**
 * Roll the grid up by objective. Because every stable matching matches the same
 * number of people, the match-rate column is flat across objectives; the
 * differences show up in cost and, above all, in the side gap. This is the table
 * to read when the question is "which objective is more equitable" rather than
 * "which setting matches the most people".
 */
export function summarizeByObjective(cells: readonly SweepCell[]): ObjectiveSummary[] {
  const byObjective = new Map<FairObjective, SweepCell[]>();
  for (const cell of cells) {
    const bucket = byObjective.get(cell.objective);
    if (bucket === undefined) byObjective.set(cell.objective, [cell]);
    else bucket.push(cell);
  }

  const summaries: ObjectiveSummary[] = [];
  for (const objective of OBJECTIVE_ORDER) {
    const bucket = byObjective.get(objective);
    if (bucket === undefined || bucket.length === 0) continue;
    const mean = (pick: (cell: SweepCell) => number): number =>
      bucket.reduce((sum, cell) => sum + pick(cell), 0) / bucket.length;
    summaries.push({
      objective,
      cells: bucket.length,
      meanMatchRate: mean((cell) => cell.matchRate),
      meanCost: mean((cell) => cell.meanCost),
      meanGap: mean((cell) => cell.satisfactionGap),
      worstGap: bucket.reduce((max, cell) => Math.max(max, cell.satisfactionGap), 0),
      meanSpan: mean((cell) => cell.latticeSpan),
      maxSpan: bucket.reduce((max, cell) => Math.max(max, cell.latticeSpan), 0),
      meanRange: mean((cell) => cell.latticeRange),
    });
  }
  return summaries;
}

export interface LatticeSummary {
  clusterCount: number;
  weightSpread: number;
  cells: number;
  meanMatchRate: number;
  meanExposedRotations: number;
  meanLatticeDepth: number;
  maxLatticeDepth: number;
  /** Mean lattice span across the objectives swept for this population. */
  meanSpan: number;
  /** Mean full lattice range across the objectives swept for this population. */
  meanRange: number;
}

/**
 * Roll the grid up by population shape, so the effect of trait clusters and
 * weight spread on the lattice is visible on its own. Flat, small numbers mean
 * the pool has an essentially unique stable matching and the fairness search has
 * nothing to choose; larger numbers mean more room.
 */
export function summarizeLatticeByPopulation(cells: readonly SweepCell[]): LatticeSummary[] {
  const groups = new Map<string, { clusterCount: number; weightSpread: number; cells: SweepCell[] }>();
  for (const cell of cells) {
    if (cell.clusterCount === undefined || cell.weightSpread === undefined) continue;
    const key = `${cell.clusterCount}|${cell.weightSpread}`;
    const group = groups.get(key);
    if (group === undefined) {
      groups.set(key, { clusterCount: cell.clusterCount, weightSpread: cell.weightSpread, cells: [cell] });
    } else {
      group.cells.push(cell);
    }
  }

  const summaries: LatticeSummary[] = [];
  for (const group of groups.values()) {
    const bucket = group.cells;
    const mean = (pick: (cell: SweepCell) => number): number =>
      bucket.reduce((sum, cell) => sum + pick(cell), 0) / bucket.length;
    summaries.push({
      clusterCount: group.clusterCount,
      weightSpread: group.weightSpread,
      cells: bucket.length,
      meanMatchRate: mean((cell) => cell.matchRate),
      meanExposedRotations: mean((cell) => cell.lattice.exposedRotations),
      meanLatticeDepth: mean((cell) => cell.lattice.latticeDepth),
      maxLatticeDepth: bucket.reduce((max, cell) => Math.max(max, cell.lattice.latticeDepth), 0),
      meanSpan: mean((cell) => cell.latticeSpan),
      meanRange: mean((cell) => cell.latticeRange),
    });
  }

  return summaries.sort(
    (a, b) => a.clusterCount - b.clusterCount || a.weightSpread - b.weightSpread,
  );
}

/**
 * Cells nobody beats. A cell is dominated when another matches at least as many
 * people, at no worse a mean cost, with no wider a satisfaction gap, and is
 * strictly better on at least one of the three.
 *
 * Settings that land on the same outcome are collapsed to one row (the smallest
 * topK / most permissive minScore among them), so the frontier lists distinct
 * trade-offs rather than every knob combination that reaches the same point.
 */
export function paretoFrontier(cells: readonly SweepCell[]): SweepCell[] {
  const unique = new Map<string, SweepCell>();
  const order = (cell: SweepCell): number => OBJECTIVE_ORDER.indexOf(cell.objective);
  for (const cell of [...cells].sort(
    (a, b) => a.topK - b.topK || a.minScore - b.minScore || order(a) - order(b),
  )) {
    const key = `${cell.matchRate.toFixed(12)}|${cell.meanCost.toFixed(12)}|${cell.satisfactionGap.toFixed(12)}`;
    if (!unique.has(key)) unique.set(key, cell);
  }

  const pool = [...unique.values()];
  const dominates = (other: SweepCell, cell: SweepCell): boolean =>
    other !== cell &&
    other.matchRate >= cell.matchRate &&
    other.meanCost <= cell.meanCost &&
    other.satisfactionGap <= cell.satisfactionGap &&
    (other.matchRate > cell.matchRate ||
      other.meanCost < cell.meanCost ||
      other.satisfactionGap < cell.satisfactionGap);

  return pool
    .filter((cell) => !pool.some((other) => dominates(other, cell)))
    .sort((a, b) => a.matchRate - b.matchRate || a.meanCost - b.meanCost);
}
