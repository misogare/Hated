/**
 * Sessions: what "signed in" means on a device.
 *
 * A session token is 32 random bytes the app keeps in the keychain. The
 * database stores only its SHA-256 hash: the token already has 256 bits of
 * entropy, so a fast hash is enough to make a leaked table useless for signing
 * in. Because sessions are rows, signing out really ends a session on the
 * server, and "sign out everywhere" ends all of a person's sessions at once.
 */

import { createHash, randomBytes } from 'node:crypto';

import type { PrismaClient } from './generated/prisma/client.js';

/** Thirty days: long enough that signing in on a phone is rare. */
export const SESSION_TTL_MS = 30 * 24 * 60 * 60 * 1000;

export interface NewSession {
  /** Give this to the app; it is never stored. */
  token: string;
  expiresAt: Date;
}

export async function createSession(
  prisma: PrismaClient,
  userId: string,
  options: { now?: Date; ttlMs?: number } = {},
): Promise<NewSession> {
  const now = options.now ?? new Date();
  const token = randomBytes(32).toString('base64url');
  const expiresAt = new Date(now.getTime() + (options.ttlMs ?? SESSION_TTL_MS));
  await prisma.session.create({ data: { userId, tokenHash: hashToken(token), createdAt: now, expiresAt } });
  return { token, expiresAt };
}

/** The user a token signs in, or null if it is unknown, signed out or expired. */
export async function resolveSession(
  prisma: PrismaClient,
  token: string,
  options: { now?: Date } = {},
): Promise<string | null> {
  if (token.length === 0) return null;
  const session = await prisma.session.findUnique({
    where: { tokenHash: hashToken(token) },
    select: { userId: true, expiresAt: true, revokedAt: true },
  });
  const now = options.now ?? new Date();
  if (session === null || session.revokedAt !== null || session.expiresAt.getTime() <= now.getTime()) return null;
  return session.userId;
}

/** Sign out this device. Unknown or already-ended tokens are fine. */
export async function revokeSession(prisma: PrismaClient, token: string, options: { now?: Date } = {}): Promise<void> {
  await prisma.session.updateMany({
    where: { tokenHash: hashToken(token), revokedAt: null },
    data: { revokedAt: options.now ?? new Date() },
  });
}

/** Sign out every device this person is signed in on. Returns how many were ended. */
export async function revokeAllSessions(prisma: PrismaClient, userId: string, options: { now?: Date } = {}): Promise<number> {
  const { count } = await prisma.session.updateMany({
    where: { userId, revokedAt: null },
    data: { revokedAt: options.now ?? new Date() },
  });
  return count;
}

function hashToken(token: string): string {
  return createHash('sha256').update(token).digest('hex');
}
