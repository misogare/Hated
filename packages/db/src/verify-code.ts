#!/usr/bin/env node
/**
 * Redeem a verification code.
 *
 * The read/act companion to `send-code`: takes the verification id that
 * `send-code` printed plus the code the user received, and runs it through the
 * same `verifyCode` the product uses. This is how you check a real code against a
 * real row without hand-writing a script.
 *
 * Usage:
 *   npm run verify-code -w @hated/db -- --id <verificationId> --code 123456
 *   npm run verify-code -w @hated/db -- <verificationId> --code 123456 --json
 *
 * Flags:
 *   --id <verificationId>  the verification to redeem (or pass it positionally)
 *   --code <code>          the submitted one-time code (required)
 *   --json                 print the outcome as JSON
 */

import 'dotenv/config';

import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { createPrismaClient } from './index.js';
import { verifyCode, type VerifyFailureReason } from './verification.js';

interface CliArgs {
  id?: string;
  code?: string;
  json: boolean;
  help: boolean;
}

function parseArgs(argv: readonly string[]): CliArgs {
  const args: CliArgs = { json: false, help: false };

  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    const value = argv[i + 1];
    const text = (): string => {
      if (value === undefined) throw new Error(`Expected a value after ${arg}`);
      i++;
      return value;
    };
    const setId = (id: string): void => {
      if (args.id !== undefined) throw new Error(`Verification id given twice: ${args.id} and ${id}`);
      args.id = id;
    };

    switch (arg) {
      case '--id':
        setId(text());
        break;
      case '--code':
        args.code = text();
        break;
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
        if (arg !== undefined && arg.length > 0) setId(arg);
    }
  }

  return args;
}

function printHelp(): void {
  console.log(`
  HateD verify code

  Redeems a submitted one-time code against a stored verification.

  Usage:
    npm run verify-code -w @hated/db -- --id <verificationId> --code <code>

  Flags:
    --id <verificationId>  the verification to redeem (or pass it positionally)
    --code <code>          the submitted one-time code (required)
    --json                 print the outcome as JSON
`);
}

/** Turn a failure reason into a sentence a human can act on. */
function explain(reason: VerifyFailureReason, attemptsRemaining?: number): string {
  switch (reason) {
    case 'unknown':
      return 'No verification with that id.';
    case 'expired':
      return 'That code has expired. Request a new one.';
    case 'too-many-attempts':
      return 'Too many wrong attempts; this request is locked. Request a new code.';
    case 'already-verified':
      return 'That verification is already complete.';
    case 'invalid-code':
      return attemptsRemaining === undefined
        ? 'Wrong code.'
        : `Wrong code. ${attemptsRemaining} attempt${attemptsRemaining === 1 ? '' : 's'} remaining.`;
  }
}

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2));
  if (args.help) {
    printHelp();
    return;
  }
  if (args.id === undefined || args.code === undefined) {
    console.error('Pass --id <verificationId> and --code <code>. Run with --help for usage.');
    process.exitCode = 1;
    return;
  }

  const prisma = createPrismaClient();
  try {
    const result = await verifyCode(prisma, { verificationId: args.id, code: args.code });

    if (args.json) {
      console.log(JSON.stringify(result, null, 2));
      if (!result.ok) process.exitCode = 1;
      return;
    }

    if (!result.ok) {
      console.error(`${explain(result.reason, result.attemptsRemaining)} [${result.reason}]`);
      process.exitCode = 1;
      return;
    }

    console.log('');
    console.log('  Code accepted');
    console.log(`    verification   ${result.verificationId}`);
    console.log(`    verified at    ${result.verifiedAt.toISOString()}`);
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
