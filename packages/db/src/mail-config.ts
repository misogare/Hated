/**
 * Choose and build the email transport from environment variables.
 *
 * One place decides which provider sends mail, so every entry point (the CLIs
 * today, an API server later) behaves the same way:
 *
 *   1. `MAIL_TRANSPORT` (or an explicit override) names `smtp`, `resend`, or `console`;
 *   2. otherwise SMTP is used when `SMTP_HOST` is set,
 *   3. then Resend when `RESEND_API_KEY` is set,
 *   4. and finally the console mailer, which only prints.
 *
 * A transport that is selected but incompletely configured is an error naming
 * every missing variable, never a silent fall-through to the next provider: a
 * half-finished SMTP setup must not quietly keep sending through Resend.
 */

import { createConsoleMailer, createResendMailer, type Mailer } from './mailer.js';
import { createSmtpMailer } from './smtp-mailer.js';

export const MAIL_TRANSPORTS = ['smtp', 'resend', 'console'] as const;

export type MailTransportKind = (typeof MAIL_TRANSPORTS)[number];

export type MailConfig =
  | {
      kind: 'console';
      /** True when nothing is configured, as opposed to the console being asked for. */
      fallback: boolean;
    }
  | { kind: 'resend'; apiKey: string; from: string }
  | {
      kind: 'smtp';
      host: string;
      port: number;
      /** Implicit TLS. False means STARTTLS, which is then required. */
      secure: boolean;
      user: string;
      pass: string;
      from: string;
    };

/** Where settings come from: `process.env`, or a plain object in tests. */
export type MailEnv = Readonly<Record<string, string | undefined>>;

export interface ResolveMailConfigOptions {
  /** Force a transport, overriding `MAIL_TRANSPORT` and auto-detection. */
  transport?: MailTransportKind;
  /** Sender override; defaults to `MAIL_FROM`. */
  from?: string;
}

const DEFAULT_SMTP_PORT = 587;

export function isMailTransportKind(value: string): value is MailTransportKind {
  return (MAIL_TRANSPORTS as readonly string[]).includes(value);
}

/**
 * Work out which transport to use and validate its settings. Throws an `Error`
 * whose message names the variables to fix.
 */
export function resolveMailConfig(env: MailEnv, options: ResolveMailConfigOptions = {}): MailConfig {
  // dotenv turns `KEY=""` into an empty string; treat blank the same as unset.
  const read = (name: string): string | undefined => {
    const value = env[name]?.trim();
    return value === undefined || value.length === 0 ? undefined : value;
  };

  const requested = options.transport ?? read('MAIL_TRANSPORT');
  if (requested !== undefined && !isMailTransportKind(requested)) {
    throw new Error(`MAIL_TRANSPORT must be one of ${MAIL_TRANSPORTS.join(', ')}; got "${requested}".`);
  }
  const kind: MailTransportKind =
    requested ?? (read('SMTP_HOST') ? 'smtp' : read('RESEND_API_KEY') ? 'resend' : 'console');
  const from = options.from?.trim() || read('MAIL_FROM');

  switch (kind) {
    case 'console':
      return { kind, fallback: requested === undefined };
    case 'resend': {
      const apiKey = read('RESEND_API_KEY');
      if (apiKey === undefined || from === undefined) {
        throw missingSettings(kind, { RESEND_API_KEY: apiKey, MAIL_FROM: from });
      }
      return { kind, apiKey, from };
    }
    case 'smtp': {
      const host = read('SMTP_HOST');
      const user = read('SMTP_USER');
      const pass = read('SMTP_PASS');
      if (host === undefined || user === undefined || pass === undefined || from === undefined) {
        throw missingSettings(kind, { SMTP_HOST: host, SMTP_USER: user, SMTP_PASS: pass, MAIL_FROM: from });
      }
      const port = parsePort(read('SMTP_PORT'));
      const secure = parseBoolean('SMTP_SECURE', read('SMTP_SECURE')) ?? port === 465;
      return { kind, host, port, secure, user, pass, from };
    }
  }
}

/** A built transport. `verify` exists when it can check its login without sending. */
export interface ConfiguredMailer extends Mailer {
  verify?(): Promise<void>;
}

export function createMailer(config: MailConfig): ConfiguredMailer {
  switch (config.kind) {
    case 'console':
      return createConsoleMailer();
    case 'resend':
      return createResendMailer({ apiKey: config.apiKey, from: config.from });
    case 'smtp':
      return createSmtpMailer({
        host: config.host,
        port: config.port,
        secure: config.secure,
        user: config.user,
        pass: config.pass,
        from: config.from,
      });
  }
}

/** One line describing the transport, for logs and CLIs. Never includes a secret. */
export function describeMailConfig(config: MailConfig): string {
  switch (config.kind) {
    case 'console':
      return 'console (prints messages instead of sending them)';
    case 'resend':
      return `resend, from ${config.from}`;
    case 'smtp':
      return (
        `smtp ${config.host}:${config.port} (${config.secure ? 'implicit TLS' : 'STARTTLS'}) ` +
        `as ${config.user}, from ${config.from}`
      );
  }
}

/**
 * A next step for a failed check or send, or `undefined` when there is nothing
 * more specific to say than the error itself. Reads the `code`, `responseCode`
 * and `response` that nodemailer attaches; Resend errors already carry their
 * HTTP status and body in the message.
 */
export function explainMailError(error: unknown, config: MailConfig): string | undefined {
  if (config.kind !== 'smtp' || typeof error !== 'object' || error === null) return undefined;

  const { code, responseCode, response } = error as {
    code?: unknown;
    responseCode?: unknown;
    response?: unknown;
  };
  const reply = typeof response === 'string' ? response : '';
  const brevo = /(^|\.)brevo\.com$/i.test(config.host);
  const brevoIpHint =
    "Brevo also refuses SMTP from IP addresses it has not authorized: add this machine's " +
    'public IP under Settings > Security > Authorized IPs, or deactivate blocking there.';

  if (/\bip\b/i.test(reply) && /authori[sz]ed|verified/i.test(reply)) {
    return brevo ? brevoIpHint : 'The server refused this IP address. Authorize it with your provider.';
  }
  if (code === 'EAUTH' || code === 'ENOAUTH' || responseCode === 535) {
    // Brevo issues API keys and SMTP keys from the same page, and its relay
    // answers both mistakes with the same bare 535, so name the key mix-up.
    if (brevo && config.pass.startsWith('xkeysib-')) {
      return [
        'SMTP_PASS holds a Brevo API key (xkeysib-…), which the SMTP relay refuses.',
        'Generate an SMTP key (xsmtpsib-…) on the SMTP tab of SMTP & API instead.',
        brevoIpHint,
      ].join(' ');
    }
    return [
      'The server refused the login.',
      'SMTP_USER must be the SMTP login, and SMTP_PASS an SMTP key or app password, not your account password.',
      ...(brevo ? [brevoIpHint] : []),
    ].join(' ');
  }
  if (code === 'ETLS') {
    return 'The TLS handshake failed. Port 465 needs implicit TLS (SMTP_SECURE=true); 587 and 2525 use STARTTLS.';
  }
  if (code === 'ETIMEDOUT' || code === 'ECONNECTION' || code === 'ESOCKET' || code === 'EDNS') {
    return (
      `Could not talk to ${config.host}:${config.port}. Check SMTP_HOST, and whether a firewall ` +
      `or ISP blocks outbound port ${config.port}; most relays${brevo ? ', Brevo included,' : ''} ` +
      'also accept 2525, or 465 with SMTP_SECURE=true.'
    );
  }
  if (code === 'EENVELOPE' || (typeof responseCode === 'number' && responseCode >= 550 && responseCode < 560)) {
    return brevo
      ? 'Brevo rejected the sender or the recipient. MAIL_FROM must be a sender verified under ' +
          'Senders, Domains & Dedicated IPs, or an address at a domain authenticated there.'
      : 'The server rejected the sender or the recipient. MAIL_FROM must be a sender the provider has verified.';
  }
  return undefined;
}

function parsePort(value: string | undefined): number {
  if (value === undefined) return DEFAULT_SMTP_PORT;
  const port = Number(value);
  if (!Number.isInteger(port) || port < 1 || port > 65_535) {
    throw new Error(`SMTP_PORT must be a port number (usually 587, or 465 for implicit TLS); got "${value}".`);
  }
  return port;
}

function parseBoolean(name: string, value: string | undefined): boolean | undefined {
  if (value === undefined) return undefined;
  switch (value.toLowerCase()) {
    case 'true':
    case '1':
    case 'yes':
      return true;
    case 'false':
    case '0':
    case 'no':
      return false;
    default:
      throw new Error(`${name} must be true or false; got "${value}".`);
  }
}

function missingSettings(kind: MailTransportKind, settings: Record<string, string | undefined>): Error {
  const missing = Object.keys(settings).filter((name) => settings[name] === undefined);
  return new Error(
    `The ${kind} mail transport needs ${missing.join(', ')}. ` +
      `Set ${missing.length === 1 ? 'it' : 'them'} in the environment ` +
      '(packages/db/.env for the CLIs; see .env.example).',
  );
}
