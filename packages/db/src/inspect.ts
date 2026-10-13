#!/usr/bin/env node
/**
 * Round inspector.
 *
 * Reads one or more persisted rounds back by id and prints what each did: the
 * header and stored metrics, every participant with their side and outcome, and
 * every pair with each side's rank and directional score. This is the read-side
 * companion to the round runner — the tool for answering "why did that round
 * match those two" after the fact.
 *
 * Usage:
 *   npm run round:inspect -w @hated/db -- <roundId>
 *   npm run round:inspect -w @hated/db -- <roundId> --json
 *   npm run round:inspect -w @hated/db -- <id1> <id2>
 *
 * Flags:
 *   --json    print the raw report(s) as JSON instead of a formatted view
 */

import 'dotenv/config';

import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { createPrismaClient } from './index.js';
import { getRoundReport, type RoundReport } from './round-info.js';

interface CliArgs {
  ids: string[];
  json: boolean;
  help: boolean;
}

function parseArgs(argv: readonly string[]): CliArgs {
  const args: CliArgs = { ids: [], json: false, help: false };

  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    switch (arg) {
      case '--json':
        args.json = true;
        break;
      case '--help':
      case '-h':
        args.help = true;
        break;
      default:
        if (arg !== undefined && arg.startsWith('--')) {
          throw new Error(`Unknown flag: ${arg}`);
        }
        if (arg !== undefined && arg.length > 0) args.ids.push(arg);
    }
  }

  return args;
}

const pct = (value: number): string => `${(value * 100).toFixed(1)}%`;
const num = (value: number): string => value.toFixed(4);
const pad = (value: string, width: number): string => value.padStart(width);
const time = (value: Date | null): string => (value === null ? '-' : value.toISOString());

function printHelp(): void {
  console.log(`
  HateD round inspector

  Reads persisted rounds back by id.

  Usage:
    npm run round:inspect -w @hated/db -- <roundId> [moreIds...] [--json]

  Flags:
    --json    print the raw report(s) as JSON instead of a formatted view
`);
}

function printReport(report: RoundReport): void {
  const { metrics } = report;

  console.log('');
  console.log(`  Round ${report.id}`);
  console.log(`    status         ${report.status}`);
  console.log(`    objective      ${report.objective}`);
  console.log(`    seed           ${report.seed ?? '-'}`);
  console.log(`    started        ${time(report.startedAt)}`);
  console.log(`    completed      ${time(report.completedAt)}`);
  console.log(`    config         ${JSON.stringify(report.config)}`);
  console.log('');
  console.log('  Outcome');
  console.log(`    population     ${report.population}`);
  console.log(`    matched        ${report.matched} pairs (${report.matched * 2} people)`);
  console.log(`    unmatched      ${report.participants.filter((p) => !p.matched).length} people`);
  console.log(`    match rate     ${pct(report.matchRate)} of people`);
  console.log(`    stable         ${report.stable ? 'yes (verified)' : 'NO - BLOCKING PAIRS EXIST'}`);

  if (metrics !== null) {
    console.log('');
    console.log('  Metrics');
    if (metrics.totalCompatiblePairs !== undefined) {
      console.log(`    compatible     ${metrics.totalCompatiblePairs} pairs`);
    }
    if (metrics.matchablePairs !== undefined) {
      console.log(`    matchable      ${metrics.matchablePairs} pairs across sides`);
    }
    if (metrics.wastedPairs !== undefined) {
      console.log(`    wasted         ${metrics.wastedPairs} pairs`);
    }
    if (metrics.firstChoiceRate !== undefined) {
      console.log(`    first choice   ${pct(metrics.firstChoiceRate)} of people`);
    }
    if (metrics.worstCost !== undefined) {
      console.log(`    worst regret   ${num(metrics.worstCost)}`);
    }
    if (metrics.satisfactionGap !== undefined) {
      console.log(`    gap            ${num(metrics.satisfactionGap)}`);
    }
    if (metrics.sideA !== undefined) {
      console.log(
        `    side A cost    ${num(metrics.sideA.meanCost ?? 0)}   first choice ${pct(
          metrics.sideA.firstChoiceRate ?? 0,
        )}`,
      );
    }
    if (metrics.sideB !== undefined) {
      console.log(
        `    side B cost    ${num(metrics.sideB.meanCost ?? 0)}   first choice ${pct(
          metrics.sideB.firstChoiceRate ?? 0,
        )}`,
      );
    }
    if (metrics.fair !== undefined) {
      console.log('');
      console.log('  Fairness');
      console.log(`    strategy       ${metrics.fair.strategy ?? '-'}`);
      console.log(`    objective      ${metrics.fair.objective ?? '-'}`);
      console.log(`    value          ${num(metrics.fair.objectiveValue ?? 0)}`);
      console.log(`    improvement    ${num(metrics.fair.improvement ?? 0)}`);
      console.log(`    rotations      ${metrics.fair.rotationsApplied ?? '-'}`);
    }
  } else {
    console.log('');
    console.log('  Metrics        not recorded');
  }

  console.log('');
  console.log(`  Participants (${report.participants.length})`);
  console.log(
    '    ' +
      ['side', 'outcome', 'profile', 'name', 'reason']
        .map((heading, index) => pad(heading, [5, 10, 28, 20, 24][index] as number))
        .join(''),
  );
  for (const participant of report.participants) {
    console.log(
      '    ' +
        [
          pad(participant.side, 5),
          pad(participant.matched ? 'matched' : 'unmatched', 10),
          pad(participant.profileId, 28),
          pad(participant.displayName, 20),
          pad(participant.unmatchedReason ?? '-', 24),
        ].join(''),
    );
  }

  console.log('');
  console.log(`  Matches (${report.matches.length})`);
  console.log(
    '    ' +
      ['A', 'name A', 'B', 'name B', 'rankA', 'rankB', 'scoreAB', 'scoreBA']
        .map((heading, index) => pad(heading, [28, 20, 28, 20, 7, 7, 9, 9][index] as number))
        .join(''),
  );
  for (const match of report.matches) {
    console.log(
      '    ' +
        [
          pad(match.profileAId, 28),
          pad(match.displayNameA, 20),
          pad(match.profileBId, 28),
          pad(match.displayNameB, 20),
          pad(match.rankA === null ? '-' : String(match.rankA), 7),
          pad(match.rankB === null ? '-' : String(match.rankB), 7),
          pad(match.scoreAB === null ? '-' : num(match.scoreAB), 9),
          pad(match.scoreBA === null ? '-' : num(match.scoreBA), 9),
        ].join(''),
    );
  }
  const { feedback } = report;
  console.log('');
  console.log(
    `  How it went: ${feedback.well} really well, ${feedback.okay} okay, ${feedback.notForMe} not for me, ${feedback.skipped} rather not say`,
  );
  console.log('');
}

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2));
  if (args.help) {
    printHelp();
    return;
  }
  if (args.ids.length === 0) {
    console.error('Pass at least one round id. Run with --help for usage.');
    process.exitCode = 1;
    return;
  }

  const prisma = createPrismaClient();
  try {
    let missing = 0;

    for (const id of args.ids) {
      const report = await getRoundReport(prisma, id);
      if (report === null) {
        console.error(`No round with id ${id}.`);
        missing++;
        continue;
      }
      if (args.json) {
        console.log(JSON.stringify(report, null, 2));
      } else {
        printReport(report);
      }
    }

    if (missing > 0) process.exitCode = 1;
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
