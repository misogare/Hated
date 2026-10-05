#!/usr/bin/env node
/**
 * Send a verification code.
 *
 * Starts an institution verification and emails the one-time code through the
 * configured transport. Real sends go to Resend (`RESEND_API_KEY`); pass
 * `--print` (or run without a key) to print the code with the console mailer
 * instead, which is what local development wants.
 *
 * Usage:
 *   npm run send-code -w @hated/db -- --email student@mit.edu
 *   npm run send-code -w @hated/db -- --email me@nasa.gov --print
 *   npm run send-code -w @hated/db -- --email a@berkeley.edu --user <userId> --json
 *
 * Flags:
 *   --email <addr>   recipient (required); must be an allowlisted .edu/.gov
 *   --user <id>      account id; default: resolved from the email in `User`
 *   --print          deliver with the console mailer instead of Resend
 *   --from <addr>    sender for Resend (default $MAIL_FROM)
 *   --app <name>     product name in the email copy (default HateD)
 *   --ttl <minutes>  override the code lifetime (default 10)
 *   --json           print the outcome as JSON
 */

import 'dotenv/config';

import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { createPrismaClient } from './index.js';
import {
  createConsoleMailer,
  createResendMailer,
  type Mailer,
} from './mailer.js';
import { normalizeEmail, requestVerificationCode } from './verification.js';

interface CliArgs {
  email?: string;
  user?: string;
  print: boolean;
  from?: string;
  app?: string;
  ttlMinutes?: number;
  json: boolean;
  help: boolean;
}

function parseArgs(argv: readonly string[]): CliArgs {
  const args: CliArgs = { print: false, json: false, help: false };

  for (let i = 0; i < argv.length; i++) {
    const flag = argv[i];
    const value = argv[i + 1];
    const text = (): string => {
      if (value === undefined) throw new Error(`Expected a value after ${flag}`);
      i++;
      return value;
    };
    const num = (): number => {
      const parsed = Number(value);
      if (value === undefined || !Number.isFinite(parsed)) {
        throw new Error(`Expected a number after ${flag}, got ${value}`);
      }
      i++;
      return parsed;
    };

    switch (flag) {
      case '--email':
        args.email = text();
        break;
      case '--user':
        args.user = text();
        break;
      case '--from':
        args.from = text();
        break;
      case '--app':
        args.app = text();
        break;
      case '--ttl':
        args.ttlMinutes = num();
        break;
      case '--print':
        args.print = true;
        break;
      case '--json':
        args.json = true;
        break;
      case '--help':
      case '-h':
        args.help = true;
        break;
      default:
        if (flag !== undefined && flag.startsWith('--')) {
          throw new Error(`Unknown flag: ${flag}`);
        }
    }
  }

  return args;
}

function printHelp(): void {
  console.log(`
  HateD send verification code

  Starts an institution verification and emails the one-time code.

  Usage:
    npm run send-code -w @hated/db -- --email <addr> [flags]

  Flags:
    --email <addr>   recipient (required); must be an allowlisted .edu/.gov
    --user <id>      account id; default: resolved from the email in User
    --print          deliver with the console mailer instead of Resend
    --from <addr>    sender for Resend (default $MAIL_FROM)
    --app <name>     product name in the email copy (default HateD)
    --ttl <minutes>  override the code lifetime (default 10)
    --json           print the outcome as JSON
`);
}

/** Pick the transport: Resend when a key and sender exist, else the console. */
function resolveMailer(args: CliArgs): { mailer: Mailer; kind: 'console' | 'resend' } {
  const apiKey = process.env.RESEND_API_KEY;
  const from = args.from ?? process.env.MAIL_FROM;

  if (args.print || !apiKey) {
    if (!args.print && !apiKey) {
      console.error('RESEND_API_KEY is not set; falling back to --print (console mailer).');
    }
    return { mailer: createConsoleMailer(), kind: 'console' };
  }
  if (from === undefined || from.trim().length === 0) {
    throw new Error('No sender address. Set MAIL_FROM or pass --from (e.g. "HateD <codes@x.com>").');
  }

  return { mailer: createResendMailer({ apiKey, from }), kind: 'resend' };
}

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2));
  if (args.help) {
    printHelp();
    return;
  }
  if (args.email === undefined) {
    console.error('Pass --email <addr>. Run with --help for usage.');
    process.exitCode = 1;
    return;
  }

  const prisma = createPrismaClient();
  try {
    const email = normalizeEmail(args.email);

    let userId = args.user;
    if (userId === undefined) {
      const user = await prisma.user.findUnique({ where: { email }, select: { id: true } });
      if (user === null) {
        console.error(`No user with email ${email}. Pass --user <id> or create the account first.`);
        process.exitCode = 1;
        return;
      }
      userId = user.id;
    }

    const { mailer, kind } = resolveMailer(args);
    const result = await requestVerificationCode(
      prisma,
      { userId, email },
      {
        mailer,
        ...(args.app === undefined ? {} : { appName: args.app }),
        ...(args.ttlMinutes === undefined ? {} : { ttlMs: args.ttlMinutes * 60_000 }),
      },
    );

    if (args.json) {
      console.log(JSON.stringify({ transport: kind, ...result }, null, 2));
      if (!result.ok) process.exitCode = 1;
      return;
    }

    if (!result.ok) {
      if (result.reason === 'unsupported-domain') {
        console.error(`${email} is not an allowlisted .edu/.gov institution domain.`);
      } else {
        const detail = result.error instanceof Error ? result.error.message : String(result.error);
        console.error(`Delivery failed; the pending code was expired. ${detail}`);
      }
      process.exitCode = 1;
      return;
    }

    console.log('');
    console.log(`  Sent a verification code via ${kind}`);
    console.log(`    to             ${result.email}`);
    console.log(`    institution    ${result.domain} (${result.type})`);
    console.log(`    verification   ${result.verificationId}`);
    console.log(`    expires        ${result.expiresAt.toISOString()}`);
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
