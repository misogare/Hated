/**
 * SMTP delivery, for any provider that offers a relay: Brevo, Gmail, SMTP2GO, ...
 *
 * Resend has an HTTP API, so its adapter in `mailer.ts` needs only `fetch`. SMTP
 * is a stateful protocol (greeting, STARTTLS, AUTH, envelope, DATA) with enough
 * sharp edges (dot-stuffing, line limits, MIME multipart, header encoding) that
 * it goes through nodemailer, which has no dependencies of its own.
 *
 * Kept out of `mailer.ts` so the verification service, which needs only the
 * `Mailer` interface and the renderer, does not load an SMTP client.
 */

import { createTransport, type SMTPTransportOptions } from 'nodemailer';

import type { EmailMessage, Mailer } from './mailer.js';

/** The slice of a nodemailer transporter this adapter uses; inject a fake in tests. */
export interface SmtpTransport {
  sendMail(mail: {
    from: string;
    to: string;
    subject: string;
    text: string;
    html: string;
  }): Promise<unknown>;
  verify(): Promise<unknown>;
}

export interface SmtpMailerOptions {
  host: string;
  /** 587 (STARTTLS) is the submission default; 465 is implicit TLS. */
  port: number;
  /**
   * Implicit TLS from the first byte. Defaults to `port === 465`. When false the
   * connection must upgrade with STARTTLS, so credentials never cross in the clear.
   */
  secure?: boolean;
  user: string;
  /** The provider's SMTP key or app password, not the account password. */
  pass: string;
  /** Sender, e.g. `HateD <codes@yourdomain.com>`; the provider must have verified it. */
  from: string;
  /** Timeout for each phase (connect, greeting, idle socket). Default 15 s. */
  timeoutMs?: number;
  /** Override the transport (tests). Defaults to a nodemailer SMTP transport. */
  transport?: SmtpTransport;
}

/** A `Mailer` that can also check the connection and login without sending. */
export interface SmtpMailer extends Mailer {
  /** Connect, upgrade to TLS, and log in. Throws with the server's reply on failure. */
  verify(): Promise<void>;
}

const DEFAULT_TIMEOUT_MS = 15_000;

/**
 * The nodemailer options for these settings. Pure, so the security-relevant
 * choices (TLS mode, timeouts) can be tested without opening a socket.
 */
export function smtpTransportOptions(options: SmtpMailerOptions): SMTPTransportOptions {
  const secure = options.secure ?? options.port === 465;
  const timeout = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  return {
    host: options.host,
    port: options.port,
    secure,
    // Without implicit TLS, refuse to log in unless the STARTTLS upgrade succeeds.
    requireTLS: !secure,
    auth: { user: options.user, pass: options.pass },
    // nodemailer's defaults (2 min to connect, 10 min idle) are far too long for
    // a request that a person is waiting on.
    connectionTimeout: timeout,
    greetingTimeout: timeout,
    socketTimeout: timeout,
  };
}

/**
 * Build a `Mailer` backed by an SMTP relay.
 *
 * A rejected sender or recipient, a failed login, or a dropped connection all
 * throw, which the verification service turns into a typed `delivery-failed`.
 */
export function createSmtpMailer(options: SmtpMailerOptions): SmtpMailer {
  const transport: SmtpTransport = options.transport ?? createTransport(smtpTransportOptions(options));

  return {
    async send(message: EmailMessage): Promise<void> {
      await transport.sendMail({
        from: options.from,
        to: message.to,
        subject: message.subject,
        text: message.text,
        html: message.html,
      });
    },
    async verify(): Promise<void> {
      await transport.verify();
    },
  };
}
