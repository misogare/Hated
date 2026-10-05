/**
 * Email delivery for verification codes.
 *
 * The verification service knows *what* to send; this module knows *how*. It
 * defines one tiny transport interface (`Mailer`) plus two implementations, so
 * the flow can be tested with a fake and run for real against Resend without the
 * service importing an email SDK.
 *
 * - `renderVerificationEmail` turns the code into a subject/text/html message.
 * - `createResendMailer` posts to Resend's HTTP API using the platform `fetch`,
 *   so no email SDK is added as a dependency.
 * - `createConsoleMailer` prints the message, for local development where no
 *   provider key is configured yet.
 *
 * The code itself is never logged except by the console mailer, which is
 * explicitly a development affordance.
 */

/** A rendered email, ready to hand to a transport. */
export interface EmailMessage {
  to: string;
  subject: string;
  /** Plain-text body. Always send both: some clients only show this one. */
  text: string;
  html: string;
}

/** A transport that delivers a rendered message. Throw on failure. */
export interface Mailer {
  send(message: EmailMessage): Promise<void>;
}

export interface VerificationEmailInput {
  to: string;
  code: string;
  /** The institution domain, e.g. `mit.edu`. */
  domain: string;
  /** Institution kind, drives the wording. */
  type: string;
  expiresInMinutes: number;
  /** Product name used in the copy. Default "HateD". */
  appName?: string;
}

const DEFAULT_APP_NAME = 'HateD';

/** Render the one-time-code email. Pure, so it is easy to snapshot-test. */
export function renderVerificationEmail(input: VerificationEmailInput): EmailMessage {
  const appName = input.appName ?? DEFAULT_APP_NAME;
  const kind = input.type === 'GOV' ? 'government' : 'school';
  const subject = `${input.code} is your ${appName} verification code`;

  const text = [
    `${appName} verification`,
    '',
    `Your one-time code for your ${kind} email (${input.domain}) is: ${input.code}`,
    `It expires in ${input.expiresInMinutes} minute${input.expiresInMinutes === 1 ? '' : 's'}.`,
    '',
    `If you didn't request this, you can ignore this email.`,
  ].join('\n');

  const html = [
    `<p>${escapeHtml(appName)} verification</p>`,
    `<p>Your one-time code for your ${kind} email (${escapeHtml(input.domain)}) is:</p>`,
    `<p style="font-size:24px;font-weight:700;letter-spacing:4px">${escapeHtml(input.code)}</p>`,
    `<p>It expires in ${input.expiresInMinutes} minute${input.expiresInMinutes === 1 ? '' : 's'}.</p>`,
    `<p style="color:#666">If you didn't request this, you can ignore this email.</p>`,
  ].join('\n');

  return { to: input.to, subject, text, html };
}

export interface ConsoleMailerOptions {
  /** Sink for the output. Defaults to `console.log`; inject in tests. */
  log?: (line: string) => void;
}

/** A mailer that prints the message. Development only: it prints the code. */
export function createConsoleMailer(options: ConsoleMailerOptions = {}): Mailer {
  const log = options.log ?? ((line: string) => console.log(line));
  return {
    async send(message: EmailMessage): Promise<void> {
      log(`[mailer:console] to=${message.to} subject=${message.subject}`);
      log(message.text);
    },
  };
}

/** The slice of a `fetch` response this adapter reads. */
export interface MailFetchResponse {
  ok: boolean;
  status: number;
  text(): Promise<string>;
}

/** Minimal `fetch` shape, so a fake can be injected and no lib types are needed. */
export type MailFetch = (
  url: string,
  init: { method: string; headers: Record<string, string>; body: string },
) => Promise<MailFetchResponse>;

export interface ResendMailerOptions {
  apiKey: string;
  /** Verified sender, e.g. `HateD <codes@yourdomain.com>`. */
  from: string;
  /** Override the API endpoint (tests, or a proxy). */
  endpoint?: string;
  /** Override `fetch` (tests). Defaults to the global. */
  fetchImpl?: MailFetch;
}

const RESEND_ENDPOINT = 'https://api.resend.com/emails';

/**
 * Build a `Mailer` backed by Resend's HTTP API.
 *
 * Uses the platform `fetch`, so wiring email needs no extra dependency. A
 * non-2xx response throws with the status and body, which the caller turns into
 * a typed `delivery-failed`.
 */
export function createResendMailer(options: ResendMailerOptions): Mailer {
  const endpoint = options.endpoint ?? RESEND_ENDPOINT;
  const fetchImpl: MailFetch = options.fetchImpl ?? globalThis.fetch;

  return {
    async send(message: EmailMessage): Promise<void> {
      const response = await fetchImpl(endpoint, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${options.apiKey}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          from: options.from,
          to: message.to,
          subject: message.subject,
          text: message.text,
          html: message.html,
        }),
      });

      if (!response.ok) {
        const body = await response.text().catch(() => '');
        throw new Error(`Resend rejected the email (${response.status}): ${body}`);
      }
    },
  };
}

/** Escape the characters that matter inside element text and attributes. */
function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}
