#!/usr/bin/env node
/**
 * Simulation harness.
 *
 * Usage:
 *   npm run sim -- --n 2000 --seed 42 --objective min-regret
 *   npm run sim -- --n 2000 --seed 42 --sweep
 *   npm run sim -- --sweep --sweepTopK 8,16,32,64 --sweepMinScore 0.5,0.7,0.9
 *   npm run sim -- --sweep --sweepObjectives egalitarian,min-regret,side-equal
 *   npm run sim -- --sweep --sweepClusters 3,5,15 --sweepWeightSpreads 0,0.5,1
 *
 * Prints what a round would actually do to a population of that shape. This is
 * the tool for answering "did that scoring tweak make things better or just
 * different", because a match round has no partial credit: it either produces a
 * stable assignment with tolerable outcomes or it does not.
 *
 * With `--sweep` it instead runs the whole topK x minScore grid and reports the
 * match-rate vs match-quality trade-off, plus the Pareto frontier of settings
 * that are not dominated by another.
 *
 * Add `--sweepObjectives` to also vary which stable matching is shipped. Match
 * rate is the same for every objective (all stable matchings match the same
 * people), so this dimension isolates equitability: the side gap and mean cost.
 *
 * Add `--sweepClusters` and/or `--sweepWeightSpreads` to vary the population
 * shape. Those change how much freedom the fairness search has, which the
 * `exRot` and `depth` columns (rotations exposed at the top / walk depth) and
 * the by-population table make concrete. Beware: every extra grid value
 * multiplies the run time, since each one re-runs the whole topK x minScore x
 * objective grid.
 *
 * `span` is the gap between the two lattice extremes; `range` is max - min of
 * the objective over a sample of stable matchings (`--latticeSample`, default
 * 128), so it can see an optimum that sits in the interior of the lattice. For
 * an objective whose optimum is at an extreme the two agree; for egalitarian the
 * range is typically the larger, more honest number.
 */

import { runMatchRound, type MatchRoundOptions } from '../round/index.js';
import type { FairObjective } from '../gs/fair.js';
import { generatePopulation, summarizePopulation } from './synthetic.js';
import {
  paretoFrontier,
  runPopulationSweep,
  summarizeByObjective,
  summarizeLatticeByPopulation,
} from './sweep.js';

interface CliArgs {
  n: number;
  seed: number;
  objective: FairObjective;
  topK: number;
  minScore: number;
  restarts: number;
  randomSteps: number;
  exhaustive: number;
  clusters: number;
  sweep: boolean;
  sweepTopK: number[];
  sweepMinScore: number[];
  sweepObjectives: FairObjective[];
  sweepClusters: number[];
  sweepWeightSpreads: number[];
  latticeSample: number;
}

const OBJECTIVES: FairObjective[] = [
  'egalitarian',
  'min-regret',
  'side-equal',
  'proposer-favored',
  'receiver-favored',
];

const DEFAULT_SWEEP_TOP_K = [4, 8, 16, 32, 64];
// Scores sit high under the default weights, so the useful threshold range is
// near the top; lower values change nothing.
const DEFAULT_SWEEP_MIN_SCORE = [0.5, 0.7, 0.8, 0.9, 0.95];

function parseArgs(argv: readonly string[]): CliArgs {
  const args: CliArgs = {
    n: 2000,
    seed: 42,
    objective: 'min-regret',
    topK: 32,
    minScore: 0.35,
    restarts: 4,
    randomSteps: 6,
    exhaustive: 9,
    clusters: 5,
    sweep: false,
    sweepTopK: DEFAULT_SWEEP_TOP_K,
    sweepMinScore: DEFAULT_SWEEP_MIN_SCORE,
    sweepObjectives: OBJECTIVES,
    // Empty means "just the single --clusters / default value".
    sweepClusters: [],
    sweepWeightSpreads: [],
    latticeSample: 128,
  };

  for (let i = 0; i < argv.length; i++) {
    const flag = argv[i];
    const value = argv[i + 1];
    const num = () => {
      const parsed = Number(value);
      if (!Number.isFinite(parsed)) throw new Error(`Expected a number after ${flag}, got ${value}`);
      i++;
      return parsed;
    };
    const list = () => {
      if (value === undefined) throw new Error(`Expected a comma-separated list after ${flag}`);
      const parsed = value.split(',').map((part) => Number(part.trim()));
      if (parsed.length === 0 || parsed.some((entry) => !Number.isFinite(entry))) {
        throw new Error(`${flag} must be a comma-separated list of numbers, got ${value}`);
      }
      i++;
      return parsed;
    };
    const names = () => {
      if (value === undefined) throw new Error(`Expected a comma-separated list after ${flag}`);
      const parsed = value
        .split(',')
        .map((part) => part.trim())
        .filter((part) => part.length > 0);
      if (parsed.length === 0) throw new Error(`${flag} must be a non-empty comma-separated list`);
      i++;
      return parsed;
    };

    switch (flag) {
      case '--n':
        args.n = num();
        break;
      case '--seed':
        args.seed = num();
        break;
      case '--topK':
        args.topK = num();
        break;
      case '--minScore':
        args.minScore = num();
        break;
      case '--restarts':
        args.restarts = num();
        break;
      case '--randomSteps':
        args.randomSteps = num();
        break;
      case '--exhaustive':
        args.exhaustive = num();
        break;
      case '--clusters':
        args.clusters = num();
        break;
      case '--sweep':
        args.sweep = true;
        break;
      case '--sweepTopK':
      case '--sweep-topk':
        args.sweepTopK = list();
        break;
      case '--sweepMinScore':
      case '--sweep-minscore':
        args.sweepMinScore = list();
        break;
      case '--sweepObjectives':
      case '--sweep-objectives': {
        const requested = names();
        for (const name of requested) {
          if (!OBJECTIVES.includes(name as FairObjective)) {
            throw new Error(`--sweepObjectives entries must be one of: ${OBJECTIVES.join(', ')}`);
          }
        }
        args.sweepObjectives = requested as FairObjective[];
        break;
      }
      case '--sweepClusters':
      case '--sweep-clusters':
        args.sweepClusters = list();
        break;
      case '--sweepWeightSpreads':
      case '--sweep-weightspreads':
        args.sweepWeightSpreads = list();
        break;
      case '--latticeSample':
      case '--lattice-sample':
        args.latticeSample = num();
        break;
      case '--objective': {
        if (value === undefined || !OBJECTIVES.includes(value as FairObjective)) {
          throw new Error(`--objective must be one of: ${OBJECTIVES.join(', ')}`);
        }
        args.objective = value as FairObjective;
        i++;
        break;
      }
      default:
        if (flag !== undefined && flag.startsWith('--')) {
          throw new Error(`Unknown flag: ${flag}`);
        }
    }
  }

  // A sweep must be deterministic: sort and de-duplicate the grids.
  args.sweepTopK = [...new Set(args.sweepTopK)].sort((a, b) => a - b);
  args.sweepMinScore = [...new Set(args.sweepMinScore)].sort((a, b) => a - b);
  args.sweepObjectives = [...new Set(args.sweepObjectives)];
  args.sweepClusters = [...new Set(args.sweepClusters)].sort((a, b) => a - b);
  args.sweepWeightSpreads = [...new Set(args.sweepWeightSpreads)].sort((a, b) => a - b);

  return args;
}

const pct = (value: number): string => `${(value * 100).toFixed(1)}%`;
const num = (value: number): string => value.toFixed(4);
const pad = (value: string, width: number): string => value.padStart(width);

function matchRoundOptions(args: CliArgs): MatchRoundOptions {
  return {
    objective: args.objective,
    exhaustiveMaxPairs: args.exhaustive,
    restarts: args.restarts,
    randomSteps: args.randomSteps,
    seed: args.seed,
  };
}

function main(): void {
  const args = parseArgs(process.argv.slice(2));

  if (args.sweep) {
    runSweepReport(args);
    return;
  }

  const profiles = generatePopulation({
    population: args.n,
    seed: args.seed,
    clusterCount: args.clusters,
  });

  const summary = summarizePopulation(profiles);
  const started = Date.now();

  const result = runMatchRound(profiles, {
    ...matchRoundOptions(args),
    firstDate: { topK: args.topK, minScore: args.minScore },
  });

  const elapsed = Date.now() - started;
  const { metrics } = result;

  console.log('');
  console.log('  HateD match simulation');
  console.log(`  seed ${args.seed}   objective ${args.objective}   topK ${args.topK}   minScore ${args.minScore}`);
  console.log('');
  console.log('  Population');
  console.log(`    total          ${summary.population}`);
  console.log(
    `    by gender      ${Object.entries(summary.byGender)
      .map(([gender, count]) => `${gender} ${count}`)
      .join('   ')}`,
  );
  console.log('');
  console.log('  Partition');
  console.log(`    side A         ${result.partition.sideA.length}`);
  console.log(`    side B         ${result.partition.sideB.length}`);
  console.log(`    compatible     ${metrics.totalCompatiblePairs} pairs`);
  console.log(`    matchable      ${metrics.matchablePairs} pairs across sides`);
  console.log(
    `    wasted         ${metrics.wastedPairs} pairs (${pct(
      metrics.totalCompatiblePairs === 0 ? 0 : metrics.wastedPairs / metrics.totalCompatiblePairs,
    )} stranded on the same side)`,
  );
  console.log('');
  console.log('  Outcome');
  console.log(`    matched        ${metrics.matched} pairs (${metrics.matched * 2} people)`);
  console.log(`    unmatched      ${result.unmatched.length} people`);
  console.log(`    match rate     ${pct(metrics.matchRate)} of people`);
  console.log(`    stable         ${metrics.stable ? 'yes (verified)' : 'NO - BLOCKING PAIRS EXIST'}`);
  console.log(`    strategy       ${result.fair.strategy}`);
  console.log(`    first choice   ${pct(metrics.firstChoiceRate)} of people`);
  console.log(`    worst regret   ${num(metrics.worstCost)}`);
  console.log('');
  console.log('  Fairness');
  console.log(`    side A cost    ${num(metrics.sideA.meanCost)}   first choice ${pct(metrics.sideA.firstChoiceRate)}`);
  console.log(`    side B cost    ${num(metrics.sideB.meanCost)}   first choice ${pct(metrics.sideB.firstChoiceRate)}`);
  console.log(`    gap            ${num(metrics.satisfactionGap)}`);
  console.log(`    textbook value ${num(result.fair.proposerOptimalValue)}  (plain Gale-Shapley)`);
  console.log(`    shipped value  ${num(result.fair.objectiveValue)}`);
  console.log(`    improvement    ${num(result.fair.improvement)}`);
  console.log('');
  console.log(`  ${elapsed}ms`);
  console.log('');
}

function runSweepReport(args: CliArgs): void {
  const clusterCounts = args.sweepClusters.length > 0 ? args.sweepClusters : [args.clusters];
  const weightSpreads = args.sweepWeightSpreads.length > 0 ? args.sweepWeightSpreads : [1];
  const started = Date.now();

  const cells = runPopulationSweep(
    {
      population: args.n,
      seed: args.seed,
      clusterCounts,
      weightSpreads,
    },
    {
      ...matchRoundOptions(args),
      topKValues: args.sweepTopK,
      minScoreValues: args.sweepMinScore,
      objectives: args.sweepObjectives,
      latticeSample: args.latticeSample,
    },
  );

  const elapsed = Date.now() - started;

  console.log('');
  console.log('  HateD parameter sweep');
  console.log(`  seed ${args.seed}   population ${args.n}`);
  console.log(
    `  grid   topK [${args.sweepTopK.join(', ')}]   minScore [${args.sweepMinScore.join(', ')}]`,
  );
  console.log(`  objectives [${args.sweepObjectives.join(', ')}]`);
  console.log(`  populations clusters [${clusterCounts.join(', ')}]   weightSpread [${weightSpreads.join(', ')}]`);
  console.log('');
  console.log(
    '  ' +
      ['objective', 'clust', 'wSpr', 'topK', 'minScore', 'match%', 'firstCh', 'meanCost', 'gap', 'gain', 'span', 'range', 'exRot', 'depth']
        .map((heading, index) =>
          pad(heading, [16, 6, 6, 5, 9, 8, 8, 9, 7, 7, 7, 7, 6, 6][index] as number),
        )
        .join(''),
  );

  for (const cell of cells) {
    console.log(
      '  ' +
        [
          pad(cell.objective, 16),
          pad(cell.clusterCount === undefined ? '-' : String(cell.clusterCount), 6),
          pad(cell.weightSpread === undefined ? '-' : cell.weightSpread.toFixed(2), 6),
          pad(String(cell.topK), 5),
          pad(cell.minScore.toFixed(2), 9),
          pad(pct(cell.matchRate), 8),
          pad(pct(cell.firstChoiceRate), 8),
          pad(num(cell.meanCost), 9),
          pad(num(cell.satisfactionGap), 7),
          pad(num(cell.improvement), 7),
          pad(num(cell.latticeSpan), 7),
          pad(num(cell.latticeRange), 7),
          pad(String(cell.lattice.exposedRotations), 6),
          pad(String(cell.lattice.latticeDepth), 6),
        ].join(''),
    );
  }

  const unstable = cells.filter((cell) => !cell.stable);
  console.log('');
  if (unstable.length > 0) {
    console.log(`  WARNING: ${unstable.length} cell(s) produced an unstable matching.`);
    console.log('');
  }

  const summaries = summarizeByObjective(cells);
  if (summaries.length > 1) {
    console.log('');
    console.log('  By objective (match rate is identical for every stable matching; this isolates equitability)');
    console.log(
      '  ' +
        ['objective', 'cells', 'match%', 'meanCost', 'meanGap', 'worstGap', 'mSpan', 'mRange']
          .map((heading, index) => pad(heading, [16, 6, 8, 9, 8, 9, 9, 9][index] as number))
          .join(''),
    );
    for (const entry of summaries) {
      console.log(
        '  ' +
          [
            pad(entry.objective, 16),
            pad(String(entry.cells), 6),
            pad(pct(entry.meanMatchRate), 8),
            pad(num(entry.meanCost), 9),
            pad(num(entry.meanGap), 8),
            pad(num(entry.worstGap), 9),
            pad(num(entry.meanSpan), 9),
            pad(num(entry.meanRange), 9),
          ].join(''),
      );
    }
  }

  const latticeSummaries = summarizeLatticeByPopulation(cells);
  if (latticeSummaries.length > 1) {
    console.log('');
    console.log(
      '  Lattice by population (exRot = rotations exposed at the top, depth = greedy walk length)',
    );
    console.log(
      '  ' +
        ['clust', 'wSpr', 'cells', 'match%', 'span', 'range', 'exRot', 'depth', 'maxDepth']
          .map((heading, index) => pad(heading, [6, 6, 6, 8, 7, 7, 7, 7, 9][index] as number))
          .join(''),
    );
    for (const entry of latticeSummaries) {
      console.log(
        '  ' +
          [
            pad(String(entry.clusterCount), 6),
            pad(entry.weightSpread.toFixed(2), 6),
            pad(String(entry.cells), 6),
            pad(pct(entry.meanMatchRate), 8),
            pad(num(entry.meanSpan), 7),
            pad(num(entry.meanRange), 7),
            pad(entry.meanExposedRotations.toFixed(2), 7),
            pad(entry.meanLatticeDepth.toFixed(2), 7),
            pad(String(entry.maxLatticeDepth), 9),
          ].join(''),
      );
    }
  }

  const frontier = paretoFrontier(cells);
  console.log('');
  console.log(
    '  Pareto frontier (no setting matches more, at lower mean cost, with a smaller side gap)',
  );
  console.log(
    '  ' +
      ['objective', 'clust', 'wSpr', 'topK', 'minScore', 'match%', 'meanCost', 'gap']
        .map((heading, index) => pad(heading, [16, 6, 6, 5, 9, 8, 9, 8][index] as number))
        .join(''),
  );
  for (const cell of frontier) {
    console.log(
      '  ' +
        [
          pad(cell.objective, 16),
          pad(cell.clusterCount === undefined ? '-' : String(cell.clusterCount), 6),
          pad(cell.weightSpread === undefined ? '-' : cell.weightSpread.toFixed(2), 6),
          pad(String(cell.topK), 5),
          pad(cell.minScore.toFixed(2), 9),
          pad(pct(cell.matchRate), 8),
          pad(num(cell.meanCost), 9),
          pad(num(cell.satisfactionGap), 8),
        ].join(''),
    );
  }

  console.log('');
  console.log(`  ${cells.length} cells in ${elapsed}ms`);
  console.log('');
}

main();
