#!/usr/bin/env node
/**
 * Objective comparison.
 *
 * Loads the stored population and runs the *same* pool through every fairness
 * objective, then compares the results side by side. The point is that match
 * rate is invariant to the objective (by the Rural Hospitals theorem every
 * stable matching matches the same people), so this isolates equitability: which
 * objective gives the two sides the most even outcome, and how much the fairness
 * search actually improved on plain Gale-Shapley.
 *
 * It reuses the engine's parameter sweep with a single (topK, minScore) cell, so
 * the numbers here match what `@hated/core` reports elsewhere.
 *
 * Usage:
 *   npm run compare -w @hated/db -- --seed 42
 *   npm run compare -w @hated/db -- --objectives egalitarian,min-regret
 *   npm run compare -w @hated/db -- --include-inactive --json
 *
 * Flags:
 *   --objectives <a,b,c>  objectives to compare (default: all five)
 *   --seed <n>            RNG seed for the fairness search (default 42)
 *   --topK <n>            FirstDate candidate cap (default 32)
 *   --minScore <n>        FirstDate minimum score (default 0.35)
 *   --latticeSample <n>   stable matchings sampled per objective (default 128)
 *   --exhaustive <n>      exact-optimum threshold in pairs
 *   --restarts <n>        randomized restarts for large pools
 *   --randomSteps <n>     random steps per restart
 *   --ids <a,b,c>         restrict to these profile ids
 *   --include-inactive    include profiles with isActive = false
 *   --json                print the rows as JSON instead of a table
 */

import 'dotenv/config';

import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { runSweep, type FairObjective, type SweepCell } from '@hated/core';

import { createPrismaClient } from './index.js';
import { loadEngineProfiles } from './population.js';

const OBJECTIVES: FairObjective[] = [
  'egalitarian',
  'min-regret',
  'side-equal',
  'proposer-favored',
  'receiver-favored',
];

interface CliArgs {
  objectives: FairObjective[];
  seed: number;
  topK: number;
  minScore: number;
  latticeSample: number;
  exhaustive?: number;
  restarts?: number;
  randomSteps?: number;
  ids?: string[];
  includeInactive: boolean;
  json: boolean;
  help: boolean;
}

function parseArgs(argv: readonly string[]): CliArgs {
  const args: CliArgs = {
    objectives: [...OBJECTIVES],
    seed: 42,
    topK: 32,
    minScore: 0.35,
    latticeSample: 128,
    includeInactive: false,
    json: false,
    help: false,
  };

  for (let i = 0; i < argv.length; i++) {
    const flag = argv[i];
    const value = argv[i + 1];
    const num = (): number => {
      const parsed = Number(value);
      if (value === undefined || !Number.isFinite(parsed)) {
        throw new Error(`Expected a number after ${flag}, got ${value}`);
      }
      i++;
      return parsed;
    };
    const names = (): string[] => {
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
      case '--seed':
        args.seed = num();
        break;
      case '--topK':
      case '--topk':
        args.topK = num();
        break;
      case '--minScore':
      case '--minscore':
        args.minScore = num();
        break;
      case '--latticeSample':
      case '--lattice-sample':
        args.latticeSample = num();
        break;
      case '--exhaustive':
        args.exhaustive = num();
        break;
      case '--restarts':
        args.restarts = num();
        break;
      case '--randomSteps':
      case '--random-steps':
        args.randomSteps = num();
        break;
      case '--ids':
        args.ids = names();
        break;
      case '--include-inactive':
        args.includeInactive = true;
        break;
      case '--json':
        args.json = true;
        break;
      case '--help':
      case '-h':
        args.help = true;
        break;
      case '--objectives': {
        const requested = names();
        for (const name of requested) {
          if (!OBJECTIVES.includes(name as FairObjective)) {
            throw new Error(`--objectives entries must be one of: ${OBJECTIVES.join(', ')}`);
          }
        }
        args.objectives = [...new Set(requested)] as FairObjective[];
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
const pad = (value: string, width: number): string => value.padStart(width);

function printHelp(): void {
  console.log(`
  HateD objective comparison

  Runs the stored population through several fairness objectives and compares them.

  Usage:
    npm run compare -w @hated/db -- [flags]

  Flags:
    --objectives <a,b,c>  objectives to compare
                          (${OBJECTIVES.join(' | ')})
    --seed <n>            RNG seed for the fairness search (default 42)
    --topK <n>            FirstDate candidate cap (default 32)
    --minScore <n>        FirstDate minimum score (default 0.35)
    --latticeSample <n>   stable matchings sampled per objective (default 128)
    --exhaustive <n>      exact-optimum threshold in pairs
    --restarts <n>        randomized restarts for large pools
    --randomSteps <n>     random steps per restart
    --ids <a,b,c>         restrict to these profile ids
    --include-inactive    include profiles with isActive = false
    --json                print the rows as JSON
`);
}

/** Show which objective won on each of the two fairness axes, with a tie-break. */
function pickFairest(cells: readonly SweepCell[]): { smallestGap: SweepCell; lowestCost: SweepCell } {
  const smallestGap = cells.reduce((best, cell) =>
    cell.satisfactionGap < best.satisfactionGap ||
    (cell.satisfactionGap === best.satisfactionGap && cell.meanCost < best.meanCost)
      ? cell
      : best,
  );
  const lowestCost = cells.reduce((best, cell) =>
    cell.meanCost < best.meanCost ||
    (cell.meanCost === best.meanCost && cell.satisfactionGap < best.satisfactionGap)
      ? cell
      : best,
  );
  return { smallestGap, lowestCost };
}

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2));
  if (args.help) {
    printHelp();
    return;
  }

  const prisma = createPrismaClient();
  try {
    const population = await loadEngineProfiles(prisma, {
      ...(args.ids === undefined ? {} : { ids: args.ids }),
      includeInactive: args.includeInactive,
    });
    if (population.length === 0) {
      console.error('No profiles to match. Seed some profiles or relax --ids / --include-inactive.');
      process.exitCode = 1;
      return;
    }

    const started = Date.now();
    const cells = runSweep(population, {
      topKValues: [args.topK],
      minScoreValues: [args.minScore],
      objectives: args.objectives,
      latticeSample: args.latticeSample,
      seed: args.seed,
      firstDate: { topK: args.topK, minScore: args.minScore },
      ...(args.exhaustive === undefined ? {} : { exhaustiveMaxPairs: args.exhaustive }),
      ...(args.restarts === undefined ? {} : { restarts: args.restarts }),
      ...(args.randomSteps === undefined ? {} : { randomSteps: args.randomSteps }),
    });
    const elapsed = Date.now() - started;

    if (args.json) {
      console.log(
        JSON.stringify(
          {
            population: population.length,
            seed: args.seed,
            topK: args.topK,
            minScore: args.minScore,
            objectives: args.objectives,
            cells,
            elapsedMs: elapsed,
          },
          null,
          2,
        ),
      );
      return;
    }

    const { smallestGap, lowestCost } = pickFairest(cells);
    const example = cells[0]!;

    console.log('');
    console.log('  HateD objective comparison');
    console.log(
      `  population ${population.length}   seed ${args.seed}   topK ${args.topK}   minScore ${args.minScore}   latticeSample ${args.latticeSample}`,
    );
    console.log('');
    console.log(
      '  ' +
        ['objective', 'match%', 'meanCost', 'worst', 'gap', 'firstCh', 'improve', 'span', 'range', 'exRot', 'depth']
          .map((heading, index) => pad(heading, [16, 8, 9, 8, 8, 8, 9, 8, 8, 6, 6][index] as number))
          .join(''),
    );
    for (const cell of cells) {
      console.log(
        '  ' +
          [
            pad(cell.objective, 16),
            pad(pct(cell.matchRate), 8),
            pad(num(cell.meanCost), 9),
            pad(num(cell.worstCost), 8),
            pad(num(cell.satisfactionGap), 8),
            pad(pct(cell.firstChoiceRate), 8),
            pad(num(cell.improvement), 9),
            pad(num(cell.latticeSpan), 8),
            pad(num(cell.latticeRange), 8),
            pad(String(cell.lattice.exposedRotations), 6),
            pad(String(cell.lattice.latticeDepth), 6),
          ].join(''),
      );
    }

    console.log('');
    console.log(
      `  match rate is ${pct(example.matchRate)} for every objective (all stable matchings match the same people);`,
    );
    console.log('  this table isolates equitability — smaller gap / mean cost is a more even outcome.');
    console.log('');
    console.log(`  smallest gap   ${num(smallestGap.satisfactionGap)}   ${smallestGap.objective}`);
    console.log(`  lowest cost    ${num(lowestCost.meanCost)}   ${lowestCost.objective}`);
    console.log('');
    console.log(`  ${elapsed}ms`);
    console.log('');
  } finally {
    await prisma.$disconnect();
  }
}

/** True when this module is the process entry point (i.e. not imported by a test). */
function isMainModule(): boolean {
  const entry = process.argv[1];
  return entry !== undefined && path.resolve(entry) === fileURLToPath(import.meta.url);
}

if (isMainModule()) {
  await main();
}

export { parseArgs, pickFairest, type CliArgs };
