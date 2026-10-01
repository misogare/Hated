#!/usr/bin/env node
/**
 * Simulation harness.
 *
 * Usage:
 *   npm run sim -- --n 2000 --seed 42 --objective min-regret
 *
 * Prints what a round would actually do to a population of that shape. This is
 * the tool for answering "did that scoring tweak make things better or just
 * different", because a match round has no partial credit: it either produces a
 * stable assignment with tolerable outcomes or it does not.
 */

import { runMatchRound } from '../round/index.js';
import type { FairObjective } from '../gs/fair.js';
import { generatePopulation, summarizePopulation } from './synthetic.js';

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
}

const OBJECTIVES: FairObjective[] = [
  'egalitarian',
  'min-regret',
  'side-equal',
  'proposer-favored',
  'receiver-favored',
];

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

  return args;
}

const pct = (value: number): string => `${(value * 100).toFixed(1)}%`;
const num = (value: number): string => value.toFixed(4);

function main(): void {
  const args = parseArgs(process.argv.slice(2));

  const profiles = generatePopulation({
    population: args.n,
    seed: args.seed,
    clusterCount: args.clusters,
  });

  const summary = summarizePopulation(profiles);
  const started = Date.now();

  const result = runMatchRound(profiles, {
    firstDate: { topK: args.topK, minScore: args.minScore },
    objective: args.objective,
    exhaustiveMaxPairs: args.exhaustive,
    restarts: args.restarts,
    randomSteps: args.randomSteps,
    seed: args.seed,
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

main();
