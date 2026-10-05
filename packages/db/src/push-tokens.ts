/** Which devices can receive a person's push notifications. */

import type { PrismaClient } from './generated/prisma/client.js';

/** What Expo push tokens look like: `ExponentPushToken[...]` (or `ExpoPushToken[...]`). */
const EXPO_PUSH_TOKEN = /^Expo(nent)?PushToken\[[^\]\s]{1,200}\]$/;

export type PushPlatform = 'ios' | 'android';

export type RegisterPushTokenResult = { ok: true } | { ok: false; reason: 'invalid' };

/**
 * Remember this device for the person. A token already registered to someone
 * else moves to them: it is the same phone, now signed in to another account.
 */
export async function registerPushToken(
  prisma: PrismaClient,
  userId: string,
  token: string,
  platform: string,
): Promise<RegisterPushTokenResult> {
  if (!EXPO_PUSH_TOKEN.test(token) || (platform !== 'ios' && platform !== 'android')) {
    return { ok: false, reason: 'invalid' };
  }
  await prisma.pushToken.upsert({
    where: { token },
    create: { userId, token, platform },
    update: { userId, platform },
  });
  return { ok: true };
}

/** Forget one device (signing out on it). Only the person's own token can be removed. */
export async function unregisterPushToken(prisma: PrismaClient, userId: string, token: string): Promise<void> {
  await prisma.pushToken.deleteMany({ where: { userId, token } });
}

/** Forget every device (signing out everywhere). */
export async function unregisterAllPushTokens(prisma: PrismaClient, userId: string): Promise<void> {
  await prisma.pushToken.deleteMany({ where: { userId } });
}

/** Tokens for each of these people, by user id. */
export async function pushTokensFor(prisma: PrismaClient, userIds: readonly string[]): Promise<Map<string, string[]>> {
  const rows = await prisma.pushToken.findMany({ where: { userId: { in: [...userIds] } }, select: { userId: true, token: true } });
  const byUser = new Map<string, string[]>();
  for (const row of rows) byUser.set(row.userId, [...(byUser.get(row.userId) ?? []), row.token]);
  return byUser;
}

/** Drop tokens the push service says no longer reach a device. */
export async function removePushTokens(prisma: PrismaClient, tokens: readonly string[]): Promise<void> {
  if (tokens.length > 0) await prisma.pushToken.deleteMany({ where: { token: { in: [...tokens] } } });
}
