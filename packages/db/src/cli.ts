#!/usr/bin/env node
/**
 * Round runner.
 *
 * Loads the stored population, runs one match round, persists it, and prints a
 * summary. This is the operational entry point: it exercises the same path an
 * API worker would (load -> run -> persist) against a real database, so a round
 * can be inspected from the outside without writing throwaway scripts.
 *
 * Usage:
 *   npm run round -w @hated/db -- --seed 42 --objective egalitarian
 *   npm run round -w @hated/db -- --dry-run
 *   npm run round -w @hated/db -- --include-inactive --json
 *
 * Flags:
 *   --seed <n>            RNG seed for the fairness search (default 42)
 *   --objective <name>    which stable matching to ship
 *                         (default min-regret)
 *   --status <name>       stored round status when persisting
 *                         (default COMPUTED)
 *   --topK <n>            FirstDate candidate cap (default engine default)
 *   --minScore <n>        FirstDate minimum score (default engine default)
 *   --ids <a,b,c>         restrict to these profile ids
 *   --include-inactive    include profiles with isActive = false
 *   --dry-run             run the round but do not write anything
 *   --json                print the summary as JSON instead of a report
 */

import 'dotenv/config';

import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { runMatchRound, type FairObjective, type MatchRoundOptions } from '@hated/core';

import type { MatchRoundStatus } from './generated/prisma/enums.js';
import { createPrismaClient } from './index.js';
import { loadEngineProfiles } from './population.js';
import { persistMatchRound } from './rounds.js';

const OBJECTIVES: FairObjective[] = [
  'egalitarian',
  'min-regret',
  'side-equal',
  'proposer-favored',
  'receiver-favored',
];

const STATUSES: MatchRoundStatus[] = ['DRAFT', 'COMPUTED', 'PUBLISHED', 'CANCELLED'];

interface CliArgs {
  seed: number;
  objective: FairObjective;
  status: MatchRoundStatus;
  topK?: number;
  minScore?: number;
  ids?: string[];
  includeInactive: boolean;
  persist: boolean;
  json: boolean;
  help: boolean;
}

function parseArgs(argv: readonly string[]): CliArgs {
  const args: CliArgs = {
    seed: 42,
    objective: 'min-regret',
    status: 'COMPUTED',
    includeInactive: false,
    persist: true,
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
      case '--ids':
        args.ids = names();
        break;
      case '--include-inactive':
        args.includeInactive = true;
        break;
      case '--dry-run':
      case '--no-persist':
        args.persist = false;
        break;
      case '--json':
        args.json = true;
        break;
      case '--help':
      case '-h':
        args.help = true;
        break;
      case '--objective': {
        if (value === undefined || !OBJECTIVES.includes(value as FairObjective)) {
          throw new Error(`--objective must be one of: ${OBJECTIVES.join(', ')}`);
        }
        args.objective = value as FairObjective;
        i++;
        break;
      }
      case '--status': {
        if (value === undefined || !STATUSES.includes(value as MatchRoundStatus)) {
          throw new Error(`--status must be one of: ${STATUSES.join(', ')}`);
        }
        args.status = value as MatchRoundStatus;
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

function roundOptions(args: CliArgs): MatchRoundOptions {
  const firstDate: MatchRoundOptions['firstDate'] = {};
  if (args.topK !== undefined) firstDate.topK = args.topK;
  if (args.minScore !== undefined) firstDate.minScore = args.minScore;

  return {
    objective: args.objective,
    seed: args.seed,
    ...(args.topK === undefined && args.minScore === undefined ? {} : { firstDate }),
  };
}

function printHelp(): void {
  console.log(`
  HateD round runner

  Loads the population, runs one match round, persists it, and prints a summary.

  Usage:
    npm run round -w @hated/db -- [flags]

  Flags:
    --seed <n>            RNG seed for the fairness search (default 42)
    --objective <name>    ${OBJECTIVES.join(' | ')}
    --status <name>       ${STATUSES.join(' | ')}
    --topK <n>            FirstDate candidate cap
    --minScore <n>        FirstDate minimum score
    --ids <a,b,c>         restrict to these profile ids
    --include-inactive    include profiles with isActive = false
    --dry-run             run the round but do not write anything
    --json                print the summary as JSON
`);
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
    const result = runMatchRound(population, roundOptions(args));
    const elapsed = Date.now() - started;

    const persisted = args.persist
      ? await persistMatchRound(prisma, result, {
          status: args.status,
          seed: args.seed,
          population,
        })
      : null;

    if (args.json) {
      console.log(
        JSON.stringify(
          {
            roundId: persisted?.roundId ?? null,
            persisted: persisted !== null,
            seed: args.seed,
            objective: result.objective,
            config: result.config,
            population: result.metrics.population,
            sides: { a: result.partition.sideA.length, b: result.partition.sideB.length },
            matched: result.metrics.matched,
            unmatched: result.unmatched.length,
            matchRate: result.metrics.matchRate,
            stable: result.metrics.stable,
            firstChoiceRate: result.metrics.firstChoiceRate,
            worstCost: result.metrics.worstCost,
            satisfactionGap: result.metrics.satisfactionGap,
            fair: {
              strategy: result.fair.strategy,
              objectiveValue: result.fair.objectiveValue,
              proposerOptimalValue: result.fair.proposerOptimalValue,
              receiverOptimalValue: result.fair.receiverOptimalValue,
              improvement: result.fair.improvement,
            },
            elapsedMs: elapsed,
          },
          null,
          2,
        ),
      );
      return;
    }

    const { metrics } = result;

    console.log('');
    console.log('  HateD match round');
    console.log(`  seed ${args.seed}   objective ${args.objective}   topK ${result.config.topK}   minScore ${result.config.minScore}`);
    console.log('');
    console.log('  Population');
    console.log(`    total          ${metrics.population}`);
    console.log(`    side A         ${result.partition.sideA.length}`);
    console.log(`    side B         ${result.partition.sideB.length}`);
    console.log(`    compatible     ${metrics.totalCompatiblePairs} pairs`);
    console.log(`    matchable      ${metrics.matchablePairs} pairs across sides`);
    console.log('');
    console.log('  Outcome');
    console.log(`    matched        ${metrics.matched} pairs (${metrics.matched * 2} people)`);
    console.log(`    unmatched      ${result.unmatched.length} people`);
    console.log(`    match rate     ${pct(metrics.matchRate)} of people`);
    console.log(`    stable         ${metrics.stable ? 'yes (verified)' : 'NO - BLOCKING PAIRS EXIST'}`);
    console.log(`    first choice   ${pct(metrics.firstChoiceRate)} of people`);
    console.log(`    worst regret   ${num(metrics.worstCost)}`);
    console.log('');
    console.log('  Fairness');
    console.log(`    strategy       ${result.fair.strategy}`);
    console.log(`    side A cost    ${num(metrics.sideA.meanCost)}   first choice ${pct(metrics.sideA.firstChoiceRate)}`);
    console.log(`    side B cost    ${num(metrics.sideB.meanCost)}   first choice ${pct(metrics.sideB.firstChoiceRate)}`);
    console.log(`    gap            ${num(metrics.satisfactionGap)}`);
    console.log(`    textbook value ${num(result.fair.proposerOptimalValue)}  (plain Gale-Shapley)`);
    console.log(`    shipped value  ${num(result.fair.objectiveValue)}`);
    console.log(`    improvement    ${num(result.fair.improvement)}`);
    console.log('');
    if (persisted === null) {
      console.log('  Persistence');
      console.log('    dry run — nothing written');
    } else {
      console.log('  Persistence');
      console.log(`    round id       ${persisted.roundId}`);
      console.log(`    status         ${args.status}`);
      console.log(`    participants   ${persisted.participants}`);
      console.log(`    matches        ${persisted.matches}`);
    }
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

export { parseArgs, type CliArgs };
