import { afterAll, beforeEach, describe, expect, it } from 'vitest';

import type { PrismaClient } from '../../src/generated/prisma/client.js';
import type { EmailMessage, Mailer } from '../../src/mailer.js';
import { startSignIn } from '../../src/sign-in.js';
import { verifyCode } from '../../src/verification.js';
import { createTestClient, hasTestDatabase, resetDatabase } from './database.js';

class CapturingMailer implements Mailer {
  readonly messages: EmailMessage[] = [];
  async send(message: EmailMessage): Promise<void> {
    this.messages.push(message);
  }
  lastCode(): string {
    const code = this.messages.at(-1)?.text.match(/\b\d{6}\b/)?.[0];
    if (code === undefined) throw new Error('no code sent');
    return code;
  }
}

describe.skipIf(!hasTestDatabase)('startSignIn (Postgres)', () => {
  let prisma: PrismaClient;
  let mailer: CapturingMailer;

  beforeEach(async () => {
    prisma ??= createTestClient();
    await resetDatabase(prisma);
    await prisma.institution.create({ data: { domain: 'vu.edu.au', name: 'Victoria University', type: 'EDU' } });
    mailer = new CapturingMailer();
  });

  afterAll(async () => {
    await prisma?.$disconnect();
  });

  const options = () => ({ mailer, scryptCost: 16 });

  it('creates the account on first use and signs it in with the emailed code', async () => {
    const started = await startSignIn(prisma, { email: ' Sam@Live.VU.edu.au ' }, options());
    if (!started.ok) throw new Error(`expected a code, got ${started.reason}`);
    expect(started.email).toBe('sam@live.vu.edu.au');

    const user = await prisma.user.findUniqueOrThrow({ where: { email: 'sam@live.vu.edu.au' } });
    const verified = await verifyCode(
      prisma,
      { verificationId: started.verificationId, code: mailer.lastCode() },
      { scryptCost: 16 },
    );

    expect(verified).toMatchObject({ ok: true, userId: user.id, accountEmailVerified: true });
    expect((await prisma.user.findUniqueOrThrow({ where: { id: user.id } })).emailVerified).toBe(true);
  });

  it('signs a returning address back in to the same account', async () => {
    const first = await startSignIn(prisma, { email: 'sam@vu.edu.au' }, options());
    const second = await startSignIn(prisma, { email: 'sam@vu.edu.au' }, { ...options(), resendCooldownMs: 0 });

    expect(first.ok && second.ok).toBe(true);
    expect(await prisma.user.count()).toBe(1);
  });

  it('refuses an address outside the allowlist without creating an account', async () => {
    const result = await startSignIn(prisma, { email: 'sam@gmail.com' }, options());

    expect(result).toEqual({ ok: false, reason: 'unsupported-domain' });
    expect(await prisma.user.count()).toBe(0);
    expect(mailer.messages).toHaveLength(0);
  });

  it('makes a second request wait out the cooldown', async () => {
    await startSignIn(prisma, { email: 'sam@vu.edu.au' }, options());
    const again = await startSignIn(prisma, { email: 'sam@vu.edu.au' }, options());

    expect(again.ok).toBe(false);
    if (again.ok || again.reason !== 'rate-limited') throw new Error('expected rate-limited');
    expect(again.retryAfterMs).toBeGreaterThan(50_000);
    expect(again.retryAfterMs).toBeLessThanOrEqual(60_000);
    expect(mailer.messages).toHaveLength(1);
  });

  it('caps codes per address per day', async () => {
    const noCooldown = { ...options(), resendCooldownMs: 0, maxCodesPerDay: 3 };
    for (let i = 0; i < 3; i++) {
      expect((await startSignIn(prisma, { email: 'sam@vu.edu.au' }, noCooldown)).ok).toBe(true);
    }
    const fourth = await startSignIn(prisma, { email: 'sam@vu.edu.au' }, noCooldown);

    expect(fourth).toMatchObject({ ok: false, reason: 'rate-limited' });
    if (!fourth.ok && fourth.reason === 'rate-limited') {
      expect(fourth.retryAfterMs).toBeGreaterThan(23 * 60 * 60 * 1000);
    }
  });
});
