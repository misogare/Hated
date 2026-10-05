/**
 * Institution verification: the emailed one-time-code flow behind `.edu` / `.gov`
 * checks.
 *
 * This is an identity-assurance gate (anti-catfish / anti-bot), not an affinity
 * signal. Two operations:
 *
 *   startVerification       -> pick a code, store only its salted hash, return
 *                              the plaintext once
 *   requestVerificationCode -> startVerification + deliver the code through a
 *                              `Mailer` (the product-facing entry point)
 *   verifyCode              -> constant-time compare, single use,
 *                              attempt-limited, time-limited; also marks the
 *                              account email verified when it is the same address
 *
 * Security notes:
 * - The code is hashed with scrypt and a per-request random salt. A six-digit
 *   code has only 10^6 possibilities, so a fast hash would be brute-forced
 *   instantly if the table leaked; scrypt makes that expensive.
 * - Codes are single use (`consumedAt`) and expire (`ttlMs`).
 * - Wrong guesses are counted and lock the request out (`maxAttempts`), so a
 *   leaked id plus an expired code cannot be ground down.
 * - Comparison uses `crypto.timingSafeEqual` to avoid leaking the code through
 *   response timing.
 */

import { randomBytes, randomInt, scrypt, timingSafeEqual } from 'node:crypto';

import type { PrismaClient } from './generated/prisma/client.js';
import type { VerificationType } from './generated/prisma/enums.js';
import { renderVerificationEmail, type Mailer } from './mailer.js';

export interface VerificationServiceOptions {
  /** Injectable clock, for tests. Defaults to `() => new Date()`. */
  now?: () => Date;
  /** How long an issued code stays valid. Default 10 minutes. */
  ttlMs?: number;
  /** Wrong guesses allowed before the request is locked. Default 5. */
  maxAttempts?: number;
  /** Digits in the code. Default 6. */
  codeLength?: number;
  /** scrypt cost (N). Lowered in tests; must be a power of two. Default 16384. */
  scryptCost?: number;
}

export interface StartVerificationInput {
  userId: string;
  /** Raw email; normalised to lowercase before use. */
  email: string;
}

export interface IssuedVerification {
  id: string;
  /** Plaintext code. Returned exactly once, for the caller to email. */
  code: string;
  domain: string;
  type: VerificationType;
  expiresAt: Date;
}

export type StartVerificationResult =
  | { ok: true; verification: IssuedVerification }
  | { ok: false; reason: 'unsupported-domain' };

export interface RequestVerificationCodeInput {
  userId: string;
  /** Raw email; normalised to lowercase before use. */
  email: string;
}

export interface RequestVerificationCodeOptions extends VerificationServiceOptions {
  /** Transport that delivers the code. */
  mailer: Mailer;
  /** Product name used in the email copy. Default "HateD". */
  appName?: string;
}

export type RequestVerificationCodeResult =
  | {
      ok: true;
      verificationId: string;
      /** Normalised recipient address the code was sent to. */
      email: string;
      domain: string;
      type: VerificationType;
      expiresAt: Date;
    }
  | {
      ok: false;
      /**
       * `unsupported-domain` when the address is not an allowlisted
       * institution; `delivery-failed` when the mailer threw (the pending code
       * is expired in that case, so it cannot be redeemed).
       */
      reason: 'unsupported-domain' | 'delivery-failed';
      /** The underlying mailer error, when delivery failed. */
      error?: unknown;
    };

export interface VerifyCodeInput {
  verificationId: string;
  code: string;
}

export type VerifyFailureReason =
  | 'unknown'
  | 'expired'
  | 'too-many-attempts'
  | 'already-verified'
  | 'invalid-code';

export type VerifyCodeResult =
  | {
      ok: true;
      verificationId: string;
      verifiedAt: Date;
      /**
       * True when the verified address is the account's own email, which this
       * redemption therefore also marked verified (`User.emailVerified`).
       */
      accountEmailVerified: boolean;
    }
  | { ok: false; reason: VerifyFailureReason; attemptsRemaining?: number };

const DEFAULT_TTL_MS = 10 * 60 * 1000;
const DEFAULT_MAX_ATTEMPTS = 5;
const DEFAULT_CODE_LENGTH = 6;
const DEFAULT_SCRYPT_COST = 16384;
const SALT_BYTES = 16;
const KEY_BYTES = 32;

/**
 * Start a verification for an email that belongs to an allowlisted institution.
 *
 * The address matches an institution by its exact domain or by any parent domain
 * in the allowlist, so `vu.edu.au` also admits `live.vu.edu.au` (student
 * subdomains). The boundary is a dot, so `notvu.edu.au` never matches.
 *
 * Any earlier pending request for the same email and type is expired first, so
 * only the most recent code can be redeemed.
 */
export async function startVerification(
  prisma: PrismaClient,
  input: StartVerificationInput,
  options: VerificationServiceOptions = {},
): Promise<StartVerificationResult> {
  const email = normalizeEmail(input.email);
  const domain = domainOf(email);
  if (domain === null) return { ok: false, reason: 'unsupported-domain' };

  const institution = await findInstitution(prisma, domain);
  if (institution === null) {
    return { ok: false, reason: 'unsupported-domain' };
  }

  const now = (options.now ?? (() => new Date()))();
  const ttlMs = options.ttlMs ?? DEFAULT_TTL_MS;
  const codeLength = options.codeLength ?? DEFAULT_CODE_LENGTH;
  const scryptCost = options.scryptCost ?? DEFAULT_SCRYPT_COST;

  const code = generateCode(codeLength);
  const salt = randomBytes(SALT_BYTES).toString('hex');
  const codeHash = await deriveCodeHash(code, salt, scryptCost);

  // Only one live code per address and verification type.
  await prisma.institutionVerification.updateMany({
    where: { email, type: institution.type, status: 'PENDING' },
    data: { status: 'EXPIRED' },
  });

  const created = await prisma.institutionVerification.create({
    data: {
      userId: input.userId,
      email,
      domain,
      type: institution.type,
      status: 'PENDING',
      codeHash,
      codeSalt: salt,
      expiresAt: new Date(now.getTime() + ttlMs),
      institutionId: institution.id,
    },
    select: { id: true, expiresAt: true },
  });

  return {
    ok: true,
    verification: {
      id: created.id,
      code,
      domain,
      type: institution.type,
      expiresAt: created.expiresAt,
    },
  };
}

/**
 * Start a verification and email the code in one call.
 *
 * This is the entry point a product route should use: it runs the same checks as
 * `startVerification`, renders the email, and hands it to the supplied mailer.
 * If delivery fails the pending request is expired, because a code the recipient
 * never received should not stay redeemable.
 */
export async function requestVerificationCode(
  prisma: PrismaClient,
  input: RequestVerificationCodeInput,
  options: RequestVerificationCodeOptions,
): Promise<RequestVerificationCodeResult> {
  const started = await startVerification(prisma, input, options);
  if (!started.ok) return { ok: false, reason: 'unsupported-domain' };

  const email = normalizeEmail(input.email);
  const ttlMs = options.ttlMs ?? DEFAULT_TTL_MS;
  const expiresInMinutes = Math.max(1, Math.round(ttlMs / 60_000));

  const message = renderVerificationEmail({
    to: email,
    code: started.verification.code,
    domain: started.verification.domain,
    type: started.verification.type,
    expiresInMinutes,
    ...(options.appName === undefined ? {} : { appName: options.appName }),
  });

  try {
    await options.mailer.send(message);
  } catch (error) {
    await expire(prisma, started.verification.id);
    return { ok: false, reason: 'delivery-failed', error };
  }

  return {
    ok: true,
    verificationId: started.verification.id,
    email,
    domain: started.verification.domain,
    type: started.verification.type,
    expiresAt: started.verification.expiresAt,
  };
}

/**
 * Redeem a code. Successful redemption is single use; failures are counted and
 * eventually lock the request out.
 */
export async function verifyCode(
  prisma: PrismaClient,
  input: VerifyCodeInput,
  options: VerificationServiceOptions = {},
): Promise<VerifyCodeResult> {
  const maxAttempts = options.maxAttempts ?? DEFAULT_MAX_ATTEMPTS;
  const scryptCost = options.scryptCost ?? DEFAULT_SCRYPT_COST;
  const now = (options.now ?? (() => new Date()))();

  const verification = await prisma.institutionVerification.findUnique({
    where: { id: input.verificationId },
  });
  if (verification === null) return { ok: false, reason: 'unknown' };

  if (verification.status === 'VERIFIED') return { ok: false, reason: 'already-verified' };
  if (verification.status !== 'PENDING') return { ok: false, reason: 'expired' };

  if (verification.expiresAt.getTime() <= now.getTime()) {
    await expire(prisma, verification.id);
    return { ok: false, reason: 'expired' };
  }

  if (verification.attempts >= maxAttempts) {
    await expire(prisma, verification.id);
    return { ok: false, reason: 'too-many-attempts' };
  }

  const candidateHash = await deriveCodeHash(input.code, verification.codeSalt ?? '', scryptCost);
  if (!hashesMatch(candidateHash, verification.codeHash)) {
    const attempts = verification.attempts + 1;
    const exhausted = attempts >= maxAttempts;
    await prisma.institutionVerification.update({
      where: { id: verification.id },
      data: { attempts, status: exhausted ? 'EXPIRED' : 'PENDING' },
    });

    return exhausted
      ? { ok: false, reason: 'too-many-attempts' }
      : { ok: false, reason: 'invalid-code', attemptsRemaining: maxAttempts - attempts };
  }

  // Proving control of the address the code went to also proves the account
  // email when they are the same address. The `where` makes the database do
  // that comparison, so a user whose email has since changed is left alone.
  // One transaction: the code is spent by this update, so if the flag were
  // written separately and failed, it could never be set by retrying.
  const [, account] = await prisma.$transaction([
    prisma.institutionVerification.update({
      where: { id: verification.id },
      data: { status: 'VERIFIED', verifiedAt: now, consumedAt: now },
    }),
    prisma.user.updateMany({
      where: { id: verification.userId, email: verification.email },
      data: { emailVerified: true },
    }),
  ]);

  return {
    ok: true,
    verificationId: verification.id,
    verifiedAt: now,
    accountEmailVerified: account.count > 0,
  };
}

function expire(prisma: PrismaClient, id: string): Promise<unknown> {
  return prisma.institutionVerification.update({
    where: { id },
    data: { status: 'EXPIRED' },
  });
}

/** Uniform, cryptographically random, zero-padded to `length` digits. */
function generateCode(length: number): string {
  const upperBound = 10 ** length;
  return randomInt(0, upperBound).toString().padStart(length, '0');
}

/**
 * The allowlisted institution for an email domain, if any.
 *
 * Matches the domain itself or the longest parent domain in the allowlist. An
 * institution controls everything under its own domain, so trusting subdomains
 * is how regional academic domains work (`vu.edu.au` covering `live.vu.edu.au`).
 * Matching only ever considers domains that are already allowlisted, and the
 * boundary is a dot label, so `notvu.edu.au` cannot match `vu.edu.au`.
 */
async function findInstitution(prisma: PrismaClient, domain: string) {
  const candidates = domainSuffixes(domain);
  const matches = await prisma.institution.findMany({
    where: { domain: { in: candidates }, isActive: true },
  });
  if (matches.length === 0) return null;
  return matches.reduce((best, candidate) =>
    candidate.domain.length > best.domain.length ? candidate : best,
  );
}

/**
 * A domain and each parent domain up to (excluding) the bare TLD, longest first:
 * `live.vu.edu.au` -> [`live.vu.edu.au`, `vu.edu.au`, `edu.au`].
 */
function domainSuffixes(domain: string): string[] {
  const labels = domain.split('.');
  const suffixes: string[] = [];
  for (let i = 0; i < labels.length - 1; i++) {
    suffixes.push(labels.slice(i).join('.'));
  }
  return suffixes;
}

/** Canonical form of an email address: trimmed and lowercased. */
export function normalizeEmail(email: string): string {
  return email.trim().toLowerCase();
}

/** Lowercased domain of a normalised email, or null if there isn't a usable one. */
function domainOf(email: string): string | null {
  const at = email.lastIndexOf('@');
  if (at <= 0 || at === email.length - 1) return null;
  const domain = email.slice(at + 1);
  return domain.includes('.') ? domain : null;
}

function deriveCodeHash(code: string, salt: string, cost: number): Promise<string> {
  return new Promise((resolve, reject) => {
    scrypt(code, salt, KEY_BYTES, { N: cost, r: 8, p: 1 }, (error, derivedKey) => {
      if (error !== null) reject(error);
      else resolve(derivedKey.toString('hex'));
    });
  });
}

/** Constant-time comparison of two hex digests; false when lengths differ. */
function hashesMatch(a: string, b: string): boolean {
  const left = Buffer.from(a, 'hex');
  const right = Buffer.from(b, 'hex');
  return left.length === right.length && timingSafeEqual(left, right);
}
