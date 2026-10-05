#!/usr/bin/env node
/**
 * Send a verification code.
 *
 * Starts an institution verification and emails the one-time code through the
 * configured transport: SMTP when `SMTP_HOST` is set, else Resend when
 * `RESEND_API_KEY` is set (see `mail-config.ts`). Pass `--print` (or run with
 * neither configured) to print the code with the console mailer instead, which
 * is what local development wants.
 *
 * Usage:
 *   npm run send-code -w @hated/db -- --email student@mit.edu
 *   npm run send-code -w @hated/db -- --email me@nasa.gov --print
 *   npm run send-code -w @hated/db -- --email a@berkeley.edu --user <userId> --json
 *
 * Flags:
 *   --email <addr>       recipient (required); must be an allowlisted .edu/.gov
 *   --user <id>          account id; default: resolved from the email in `User`
 *   --transport <kind>   smtp, resend, or console (default $MAIL_TRANSPORT, else auto)
 *   --print              shorthand for --transport console
 *   --from <addr>        sender (default $MAIL_FROM)
 *   --app <name>         product name in the email copy (default HateD)
 *   --ttl <minutes>      override the code lifetime (default 10)
 *   --json               print the outcome as JSON
 */

import 'dotenv/config';

import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { createPrismaClient } from './index.js';
import {
  MAIL_TRANSPORTS,
  createMailer,
  explainMailError,
  isMailTransportKind,
  resolveMailConfig,
  type MailConfig,
  type MailTransportKind,
} from './mail-config.js';
import { normalizeEmail, requestVerificationCode } from './verification.js';

interface CliArgs {
  email?: string;
  user?: string;
  transport?: MailTransportKind;
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
      case '--transport': {
        const kind = text();
        if (!isMailTransportKind(kind)) {
          throw new Error(`--transport must be one of ${MAIL_TRANSPORTS.join(', ')}, got ${kind}`);
        }
        args.transport = kind;
        break;
      }
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
    --email <addr>       recipient (required); must be an allowlisted .edu/.gov
    --user <id>          account id; default: resolved from the email in User
    --transport <kind>   smtp, resend, or console (default $MAIL_TRANSPORT, else auto)
    --print              shorthand for --transport console
    --from <addr>        sender (default $MAIL_FROM)
    --app <name>         product name in the email copy (default HateD)
    --ttl <minutes>      override the code lifetime (default 10)
    --json               print the outcome as JSON

  Auto-detection picks SMTP when SMTP_HOST is set, then Resend when
  RESEND_API_KEY is set, then the console. Run \`npm run mail:check\` to test
  the transport without touching the database.
`);
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

  // Settle the transport before touching the database, so a configuration
  // mistake fails fast and never leaves a pending code behind.
  let config: MailConfig;
  try {
    config = resolveMailConfig(process.env, {
      transport: args.print ? 'console' : args.transport,
      from: args.from,
    });
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
    return;
  }
  if (config.kind === 'console' && config.fallback) {
    console.error('No mail transport is configured (SMTP_HOST or RESEND_API_KEY); printing the code instead.');
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

    const kind = config.kind;
    const result = await requestVerificationCode(
      prisma,
      { userId, email },
      {
        mailer: createMailer(config),
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
        const hint = explainMailError(result.error, config);
        if (hint !== undefined) console.error(hint);
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
