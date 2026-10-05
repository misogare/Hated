import { afterAll, beforeEach, describe, expect, it } from 'vitest';

import type { PrismaClient } from '../../src/generated/prisma/client.js';
import { createSession, resolveSession, revokeAllSessions, revokeSession } from '../../src/sessions.js';
import { createTestClient, hasTestDatabase, resetDatabase } from './database.js';

const NOW = new Date('2026-10-05T12:00:00Z');

describe.skipIf(!hasTestDatabase)('sessions (Postgres)', () => {
  let prisma: PrismaClient;
  let userId: string;

  beforeEach(async () => {
    prisma ??= createTestClient();
    await resetDatabase(prisma);
    userId = (await prisma.user.create({ data: { email: 'sam@vu.edu.au' } })).id;
  });

  afterAll(async () => {
    await prisma?.$disconnect();
  });

  it('signs a device in until the session expires', async () => {
    const { token, expiresAt } = await createSession(prisma, userId, { now: NOW, ttlMs: 60_000 });

    expect(expiresAt).toEqual(new Date(NOW.getTime() + 60_000));
    expect(await resolveSession(prisma, token, { now: NOW })).toBe(userId);
    expect(await resolveSession(prisma, token, { now: new Date(NOW.getTime() + 60_000) })).toBeNull();
  });

  it('stores only a hash of the token', async () => {
    const { token } = await createSession(prisma, userId);
    const stored = await prisma.session.findFirstOrThrow();

    expect(stored.tokenHash).not.toContain(token);
    expect(stored.tokenHash).toMatch(/^[0-9a-f]{64}$/);
  });

  it('signs out one device, leaving the others signed in', async () => {
    const phone = await createSession(prisma, userId);
    const laptop = await createSession(prisma, userId);

    await revokeSession(prisma, phone.token);
    expect(await resolveSession(prisma, phone.token)).toBeNull();
    expect(await resolveSession(prisma, laptop.token)).toBe(userId);
  });

  it('signs out every device at once', async () => {
    const phone = await createSession(prisma, userId);
    const laptop = await createSession(prisma, userId);

    expect(await revokeAllSessions(prisma, userId)).toBe(2);
    expect(await resolveSession(prisma, phone.token)).toBeNull();
    expect(await resolveSession(prisma, laptop.token)).toBeNull();
  });

  it('rejects unknown and empty tokens', async () => {
    expect(await resolveSession(prisma, 'not-a-token')).toBeNull();
    expect(await resolveSession(prisma, '')).toBeNull();
  });
});
