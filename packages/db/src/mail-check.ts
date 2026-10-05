#!/usr/bin/env node
/**
 * Check the email transport without touching the database.
 *
 * Resolves the transport exactly as `send-code` does and says which one it
 * picked. For SMTP it then connects, upgrades to TLS and logs in, without
 * sending anything. With `--to` it also sends a sample verification email,
 * which is the only way to see where a message lands (inbox or spam) before
 * real users do.
 *
 * Usage:
 *   npm run mail:check -w @hated/db
 *   npm run mail:check -w @hated/db -- --to you@example.com
 *   npm run mail:check -w @hated/db -- --transport resend --to you@example.com
 *
 * Flags:
 *   --to <addr>          also send a sample verification email to this address
 *   --transport <kind>   smtp, resend, or console (default $MAIL_TRANSPORT, else auto)
 *   --from <addr>        sender (default $MAIL_FROM)
 *   --app <name>         product name in the sample copy (default HateD)
 */

import 'dotenv/config';

import path from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  MAIL_TRANSPORTS,
  createMailer,
  describeMailConfig,
  explainMailError,
  isMailTransportKind,
  resolveMailConfig,
  type MailConfig,
  type MailTransportKind,
} from './mail-config.js';
import { renderVerificationEmail } from './mailer.js';
import { normalizeEmail } from './verification.js';

interface CliArgs {
  to?: string;
  transport?: MailTransportKind;
  from?: string;
  app?: string;
  help: boolean;
}

/** The code in the sample email. Obviously fake, so nobody mistakes it for a real one. */
const SAMPLE_CODE = '123456';

function parseArgs(argv: readonly string[]): CliArgs {
  const args: CliArgs = { help: false };

  for (let i = 0; i < argv.length; i++) {
    const flag = argv[i];
    const value = argv[i + 1];
    const text = (): string => {
      if (value === undefined) throw new Error(`Expected a value after ${flag}`);
      i++;
      return value;
    };

    switch (flag) {
      case '--to': {
        const to = normalizeEmail(text());
        if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(to)) {
          throw new Error(`--to must be an email address, got ${to}`);
        }
        args.to = to;
        break;
      }
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
  HateD mail check

  Shows which email transport is configured and, for SMTP, checks that it can
  connect, upgrade to TLS and log in. Needs no database.

  Usage:
    npm run mail:check -w @hated/db -- [flags]

  Flags:
    --to <addr>          also send a sample verification email to this address
    --transport <kind>   smtp, resend, or console (default $MAIL_TRANSPORT, else auto)
    --from <addr>        sender (default $MAIL_FROM)
    --app <name>         product name in the sample copy (default HateD)
`);
}

/** Print a failed step with a next step when there is one, and fail the process. */
function reportFailure(step: string, error: unknown, config: MailConfig): void {
  console.error(`  ${step.padEnd(11)} FAILED: ${error instanceof Error ? error.message : String(error)}`);
  const hint = explainMailError(error, config);
  if (hint !== undefined) console.error(`\n  ${hint}`);
  console.error('');
  process.exitCode = 1;
}

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2));
  if (args.help) {
    printHelp();
    return;
  }

  let config: MailConfig;
  try {
    config = resolveMailConfig(process.env, { transport: args.transport, from: args.from });
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
    return;
  }

  console.log('');
  console.log(`  Transport   ${describeMailConfig(config)}`);
  if (config.kind === 'console' && config.fallback) {
    console.log('              nothing configured: set SMTP_HOST or RESEND_API_KEY in packages/db/.env');
  }

  const mailer = createMailer(config);
  if (mailer.verify !== undefined) {
    try {
      await mailer.verify();
      console.log('  Login       ok (connected, TLS, authenticated)');
    } catch (error) {
      reportFailure('Login', error, config);
      return;
    }
  } else if (config.kind === 'resend') {
    console.log('  Login       Resend has no check short of sending; pass --to to send one');
  }

  if (args.to !== undefined) {
    const sample = renderVerificationEmail({
      to: args.to,
      code: SAMPLE_CODE,
      domain: args.to.slice(args.to.lastIndexOf('@') + 1),
      type: 'EDU',
      expiresInMinutes: 10,
      appName: args.app,
    });
    try {
      await mailer.send({ ...sample, subject: `[mail:check] ${sample.subject}` });
      console.log(
        config.kind === 'console'
          ? '  Test send   printed above; the console transport delivers nothing'
          : `  Test send   sent to ${args.to}; check the inbox and the spam folder`,
      );
    } catch (error) {
      reportFailure('Test send', error, config);
      return;
    }
  }
  console.log('');
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
