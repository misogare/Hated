#!/usr/bin/env node
/**
 * Fill the development database with a fictional demo population, so a round
 * has people to match. Replaces any earlier demo population; real accounts are
 * never touched.
 *
 * Usage:
 *   npm run seed:demo                 # 24 demo members
 *   npm run seed:demo -- --count 40 --seed 3
 *   npm run seed:demo -- --clear      # remove them again
 *
 * Then run a round and publish it:
 *   npm run round -- --status PUBLISHED
 */

import 'dotenv/config';

import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { DEMO_DOMAIN, clearDemoPopulation, seedDemoPopulation } from './demo.js';
import { createPrismaClient } from './index.js';
import { seedDatabase } from './seed.js';

interface CliArgs {
  count?: number;
  seed?: number;
  clear: boolean;
  help: boolean;
}

function parseArgs(argv: readonly string[]): CliArgs {
  const args: CliArgs = { clear: false, help: false };
  for (let i = 0; i < argv.length; i++) {
    const flag = argv[i];
    const value = argv[i + 1];
    const num = (): number => {
      const parsed = Number(value);
      if (value === undefined || !Number.isInteger(parsed) || parsed < 0) {
        throw new Error(`Expected a whole number after ${flag}, got ${value}`);
      }
      i++;
      return parsed;
    };
    switch (flag) {
      case '--count':
        args.count = num();
        break;
      case '--seed':
        args.seed = num();
        break;
      case '--clear':
        args.clear = true;
        break;
      case '--help':
      case '-h':
        args.help = true;
        break;
      default:
        if (flag !== undefined && flag.startsWith('--')) throw new Error(`Unknown flag: ${flag}`);
    }
  }
  return args;
}

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2));
  if (args.help) {
    console.log('Usage: npm run seed:demo -- [--count <n>] [--seed <n>] [--clear]');
    return;
  }

  const prisma = createPrismaClient();
  try {
    if (args.clear) {
      const removed = await clearDemoPopulation(prisma);
      console.log(`Removed ${removed} demo member${removed === 1 ? '' : 's'}.`);
      return;
    }
    await seedDatabase(prisma);
    const summary = await seedDemoPopulation(prisma, { count: args.count, seed: args.seed });
    console.log('');
    console.log(`  Created ${summary.created} demo members at @${DEMO_DOMAIN}`);
    for (const [label, count] of Object.entries(summary.mix)) console.log(`    ${String(count).padStart(3)}  ${label}`);
    console.log('');
    console.log('  Next: npm run round -- --status PUBLISHED');
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
