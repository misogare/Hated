/**
 * Sign-in by emailed code: the account flow the app uses.
 *
 * There are no passwords. Proving control of an allowlisted institution address
 * is both sign-up and sign-in: the first time an address asks for a code its
 * account is created, and every later request signs back in to the same
 * account. Redeeming the code is plain `verifyCode`, which reports the `userId`.
 *
 * Each code is a real email from a capped free plan, and each is a fresh chance
 * to guess, so requests are rate limited per address: a short cooldown between
 * codes and a daily cap.
 */

import type { PrismaClient } from './generated/prisma/client.js';
import {
  findInstitutionForEmail,
  normalizeEmail,
  requestVerificationCode,
  type RequestVerificationCodeOptions,
} from './verification.js';

export interface StartSignInOptions extends RequestVerificationCodeOptions {
  /** Minimum gap between two codes for one address. Default 60 seconds. */
  resendCooldownMs?: number;
  /** Most codes one address can request in 24 hours. Default 10. */
  maxCodesPerDay?: number;
}

export type StartSignInResult =
  | { ok: true; verificationId: string; email: string; expiresAt: Date }
  | { ok: false; reason: 'unsupported-domain' }
  | { ok: false; reason: 'rate-limited'; retryAfterMs: number }
  | { ok: false; reason: 'delivery-failed'; error?: unknown };

const DEFAULT_RESEND_COOLDOWN_MS = 60_000;
const DEFAULT_MAX_CODES_PER_DAY = 10;
const DAY_MS = 24 * 60 * 60 * 1000;

/**
 * Email a sign-in code, creating the account on first use.
 *
 * The allowlist is checked before anything is written, so an unsupported
 * address never leaves an account behind.
 */
export async function startSignIn(
  prisma: PrismaClient,
  input: { email: string },
  options: StartSignInOptions,
): Promise<StartSignInResult> {
  const email = normalizeEmail(input.email);
  if ((await findInstitutionForEmail(prisma, email)) === null) {
    return { ok: false, reason: 'unsupported-domain' };
  }

  const now = (options.now ?? (() => new Date()))().getTime();
  const retryAfterMs = await rateLimitWait(prisma, email, now, options);
  if (retryAfterMs > 0) return { ok: false, reason: 'rate-limited', retryAfterMs };

  const user = await prisma.user.upsert({
    where: { email },
    create: { email },
    update: {},
    select: { id: true },
  });

  const sent = await requestVerificationCode(prisma, { userId: user.id, email }, options);
  if (!sent.ok) {
    return sent.reason === 'unsupported-domain'
      ? { ok: false, reason: 'unsupported-domain' }
      : { ok: false, reason: 'delivery-failed', error: sent.error };
  }
  return { ok: true, verificationId: sent.verificationId, email: sent.email, expiresAt: sent.expiresAt };
}

/** Milliseconds until this address may ask for another code; 0 when it may now. */
async function rateLimitWait(
  prisma: PrismaClient,
  email: string,
  now: number,
  options: StartSignInOptions,
): Promise<number> {
  const cooldownMs = options.resendCooldownMs ?? DEFAULT_RESEND_COOLDOWN_MS;
  const maxPerDay = options.maxCodesPerDay ?? DEFAULT_MAX_CODES_PER_DAY;

  const recent = await prisma.institutionVerification.findMany({
    where: { email, createdAt: { gt: new Date(now - DAY_MS) } },
    orderBy: { createdAt: 'asc' },
    select: { createdAt: true },
  });
  if (recent.length === 0) return 0;

  const newest = recent[recent.length - 1]!.createdAt.getTime();
  const cooldownWait = newest + cooldownMs - now;
  // At the cap, the next slot opens when the oldest code in the window ages out.
  const capWait = recent.length >= maxPerDay ? recent[recent.length - maxPerDay]!.createdAt.getTime() + DAY_MS - now : 0;
  return Math.max(0, cooldownWait, capWait);
}
