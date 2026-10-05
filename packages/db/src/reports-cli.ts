#!/usr/bin/env node
/**
 * Review reports from the command line.
 *
 * Usage:
 *   npm run reports                    # open reports, oldest first
 *   npm run reports -- --all           # include resolved ones
 *   npm run reports -- --resolve <id>  # mark one as reviewed
 *   npm run reports -- --json
 */

import 'dotenv/config';

import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { createPrismaClient } from './index.js';
import { listReports, resolveReport } from './reports.js';

interface CliArgs {
  all: boolean;
  json: boolean;
  resolve?: string;
  help: boolean;
}

function parseArgs(argv: readonly string[]): CliArgs {
  const args: CliArgs = { all: false, json: false, help: false };
  for (let i = 0; i < argv.length; i++) {
    const flag = argv[i];
    switch (flag) {
      case '--all':
        args.all = true;
        break;
      case '--json':
        args.json = true;
        break;
      case '--resolve': {
        const id = argv[i + 1];
        if (id === undefined) throw new Error('Expected a report id after --resolve');
        args.resolve = id;
        i++;
        break;
      }
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
    console.log('Usage: npm run reports -- [--all] [--resolve <id>] [--json]');
    return;
  }

  const prisma = createPrismaClient();
  try {
    if (args.resolve !== undefined) {
      const found = await resolveReport(prisma, args.resolve);
      console.log(found ? `Marked ${args.resolve} as reviewed.` : `No report ${args.resolve}.`);
      if (!found) process.exitCode = 1;
      return;
    }

    const reports = await listReports(prisma, { includeResolved: args.all });
    if (args.json) {
      console.log(JSON.stringify(reports, null, 2));
      return;
    }
    if (reports.length === 0) {
      console.log(args.all ? 'No reports.' : 'No open reports.');
      return;
    }
    for (const report of reports) {
      console.log('');
      console.log(`  ${report.id}   ${report.createdAt.slice(0, 16).replace('T', ' ')}   ${report.resolvedAt ? 'reviewed' : 'OPEN'}`);
      console.log(`    reason     ${report.reason}`);
      console.log(`    reported   ${report.reported.name} <${report.reported.email}>  (${report.reportsAboutThem} report${report.reportsAboutThem === 1 ? '' : 's'} in total)`);
      console.log(`    by         ${report.reporter === null ? '(a deleted account)' : `${report.reporter.name} <${report.reporter.email}>`}`);
      if (report.details !== null) console.log(`    details    ${report.details}`);
    }
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
