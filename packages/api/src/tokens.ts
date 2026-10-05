/**
 * Session tokens: `<payload>.<signature>`, both base64url, where the payload is
 * `{ sub, exp }` JSON and the signature is HMAC-SHA256 over the payload.
 *
 * Stateless by design for now: a token is valid until it expires, so signing
 * out on the server (revoking one token) is not supported yet. Rotating
 * AUTH_SECRET signs everyone out.
 */

import { createHmac, timingSafeEqual } from 'node:crypto';

export interface SessionToken {
  token: string;
  userId: string;
  expiresAt: Date;
}

/** Thirty days: long enough that sign-in is rare on a phone. */
export const SESSION_TTL_MS = 30 * 24 * 60 * 60 * 1000;

/** Secrets shorter than this are refused, so a placeholder cannot ship. */
export const MIN_SECRET_LENGTH = 32;

export function issueToken(userId: string, secret: string, now: Date, ttlMs = SESSION_TTL_MS): SessionToken {
  assertSecret(secret);
  const expiresAt = new Date(now.getTime() + ttlMs);
  const payload = Buffer.from(JSON.stringify({ sub: userId, exp: expiresAt.getTime() })).toString('base64url');
  return { token: `${payload}.${sign(payload, secret)}`, userId, expiresAt };
}

/** The user a token names, or null if it is malformed, forged or expired. */
export function verifyToken(token: string, secret: string, now: Date): string | null {
  assertSecret(secret);
  const [payload, signature, extra] = token.split('.');
  if (payload === undefined || signature === undefined || extra !== undefined) return null;

  const expected = Buffer.from(sign(payload, secret));
  const actual = Buffer.from(signature);
  if (actual.length !== expected.length || !timingSafeEqual(actual, expected)) return null;

  let claims: unknown;
  try {
    claims = JSON.parse(Buffer.from(payload, 'base64url').toString('utf8'));
  } catch {
    return null;
  }
  const { sub, exp } = (claims ?? {}) as { sub?: unknown; exp?: unknown };
  if (typeof sub !== 'string' || typeof exp !== 'number' || exp <= now.getTime()) return null;
  return sub;
}

function sign(payload: string, secret: string): string {
  return createHmac('sha256', secret).update(payload).digest('base64url');
}

function assertSecret(secret: string): void {
  if (secret.length < MIN_SECRET_LENGTH) {
    throw new Error(`AUTH_SECRET must be at least ${MIN_SECRET_LENGTH} characters.`);
  }
}
