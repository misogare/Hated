import { beforeEach, describe, expect, it } from 'vitest';

import type { PrismaClient } from '../src/generated/prisma/client.js';
import type { EmailMessage, Mailer } from '../src/mailer.js';
import {
  requestVerificationCode,
  startVerification,
  verifyCode,
  type VerificationServiceOptions,
} from '../src/verification.js';

/** Captures sent messages; can be told to fail, to exercise delivery errors. */
class FakeMailer implements Mailer {
  readonly messages: EmailMessage[] = [];
  fail: Error | null = null;

  async send(message: EmailMessage): Promise<void> {
    if (this.fail !== null) throw this.fail;
    this.messages.push(message);
  }
}

type InstitutionType = 'EDU' | 'GOV';
type Status = 'PENDING' | 'VERIFIED' | 'EXPIRED' | 'REVOKED';

interface FakeInstitution {
  id: string;
  domain: string;
  name: string;
  type: InstitutionType;
  isActive: boolean;
}

interface FakeVerification {
  id: string;
  userId: string;
  email: string;
  domain: string;
  type: InstitutionType;
  status: Status;
  codeHash: string;
  codeSalt: string | null;
  attempts: number;
  expiresAt: Date;
  consumedAt: Date | null;
  verifiedAt: Date | null;
  institutionId: string | null;
}

interface FakeUser {
  id: string;
  email: string;
  emailVerified: boolean;
}

/** Minimal in-memory stand-in for the Prisma delegates the service uses. */
class FakeStore {
  readonly institutions = new Map<string, FakeInstitution>();
  readonly verifications = new Map<string, FakeVerification>();
  readonly users = new Map<string, FakeUser>();
  private sequence = 0;

  addInstitution(institution: Omit<FakeInstitution, 'id'>): void {
    this.institutions.set(institution.domain, { id: `inst-${++this.sequence}`, ...institution });
  }

  addUser(id: string, email: string): FakeUser {
    const user = { id, email, emailVerified: false };
    this.users.set(id, user);
    return user;
  }

  /** Batch form only: the operations already ran, so just collect their results. */
  readonly $transaction = (operations: Promise<unknown>[]) => Promise.all(operations);

  readonly user = {
    updateMany: async ({
      where,
      data,
    }: {
      where: { id: string; email: string };
      data: Partial<FakeUser>;
    }) => {
      const user = this.users.get(where.id);
      if (user === undefined || user.email !== where.email) return { count: 0 };
      Object.assign(user, data);
      return { count: 1 };
    },
  };

  readonly institution = {
    findMany: async ({
      where,
    }: {
      where: { domain: { in: string[] }; isActive?: boolean };
    }) => {
      const wanted = new Set(where.domain.in);
      return [...this.institutions.values()].filter(
        (institution) =>
          wanted.has(institution.domain) &&
          (where.isActive === undefined || institution.isActive === where.isActive),
      );
    },
  };

  readonly institutionVerification = {
    findUnique: async ({ where }: { where: { id: string } }) =>
      this.verifications.get(where.id) ?? null,
    create: async ({ data }: { data: Omit<FakeVerification, 'id'> }) => {
      // Mirror the schema defaults Prisma would return (e.g. attempts = 0).
      const row: FakeVerification = {
        id: `ver-${++this.sequence}`,
        attempts: 0,
        consumedAt: null,
        verifiedAt: null,
        ...data,
      };
      this.verifications.set(row.id, row);
      return row;
    },
    update: async ({
      where,
      data,
    }: {
      where: { id: string };
      data: Partial<FakeVerification>;
    }) => {
      const row = this.verifications.get(where.id);
      if (row === undefined) throw new Error(`no verification ${where.id}`);
      Object.assign(row, data);
      return row;
    },
    updateMany: async ({
      where,
      data,
    }: {
      where: { email?: string; type?: InstitutionType; status?: Status };
      data: Partial<FakeVerification>;
    }) => {
      let count = 0;
      for (const row of this.verifications.values()) {
        if (
          (where.email === undefined || row.email === where.email) &&
          (where.type === undefined || row.type === where.type) &&
          (where.status === undefined || row.status === where.status)
        ) {
          Object.assign(row, data);
          count += 1;
        }
      }
      return { count };
    },
  };
}

const TTL_MS = 60_000;
const MAX_ATTEMPTS = 3;

let clock: Date;
let store: FakeStore;
let client: PrismaClient;
let options: VerificationServiceOptions;

function setClock(iso: string): void {
  clock = new Date(iso);
}

beforeEach(() => {
  setClock('2026-01-01T00:00:00.000Z');
  store = new FakeStore();
  store.addInstitution({ domain: 'example.edu', name: 'Example University', type: 'EDU', isActive: true });
  store.addInstitution({ domain: 'closed.edu', name: 'Closed College', type: 'EDU', isActive: false });
  client = store as unknown as PrismaClient;
  options = { now: () => clock, ttlMs: TTL_MS, maxAttempts: MAX_ATTEMPTS, scryptCost: 16 };
});

function onlyVerification(): FakeVerification {
  const rows = [...store.verifications.values()];
  if (rows.length !== 1) throw new Error(`expected exactly one verification, got ${rows.length}`);
  return rows[0]!;
}

describe('startVerification', () => {
  it('rejects an email whose domain is not allowlisted', async () => {
    const result = await startVerification(client, { userId: 'u1', email: 'a@unknown.edu' }, options);
    expect(result).toEqual({ ok: false, reason: 'unsupported-domain' });
    expect(store.verifications.size).toBe(0);
  });

  it('rejects an institution that is not active', async () => {
    const result = await startVerification(client, { userId: 'u1', email: 'a@closed.edu' }, options);
    expect(result).toEqual({ ok: false, reason: 'unsupported-domain' });
  });

  it('accepts a subdomain of an allowlisted institution', async () => {
    const result = await startVerification(client, { userId: 'u1', email: 'a@cs.example.edu' }, options);

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.verification.domain).toBe('cs.example.edu');
    expect(result.verification.type).toBe('EDU');
    expect(onlyVerification().institutionId).toBe(store.institutions.get('example.edu')!.id);
  });

  it('matches the most specific allowlisted domain', async () => {
    store.addInstitution({ domain: 'example.edu', name: 'Example', type: 'EDU', isActive: true });
    store.addInstitution({ domain: 'cs.example.edu', name: 'CS', type: 'EDU', isActive: true });

    const result = await startVerification(client, { userId: 'u1', email: 'a@cs.example.edu' }, options);
    if (!result.ok) throw new Error('expected start to succeed');

    const csId = [...store.institutions.values()].find((i) => i.domain === 'cs.example.edu')!.id;
    expect(onlyVerification().institutionId).toBe(csId);
  });

  it('rejects lookalike domains that are not real subdomains', async () => {
    const lookalike = await startVerification(client, { userId: 'u1', email: 'a@notexample.edu' }, options);
    const sneaky = await startVerification(
      client,
      { userId: 'u1', email: 'a@example.edu.evil.com' },
      options,
    );

    expect(lookalike).toEqual({ ok: false, reason: 'unsupported-domain' });
    expect(sneaky).toEqual({ ok: false, reason: 'unsupported-domain' });
  });

  it('normalises the email and stores only a salted hash of the code', async () => {
    const result = await startVerification(
      client,
      { userId: 'u1', email: '  Student@Example.EDU ' },
      options,
    );
    expect(result.ok).toBe(true);
    if (!result.ok) return;

    expect(result.verification.type).toBe('EDU');
    expect(result.verification.domain).toBe('example.edu');
    expect(result.verification.code).toMatch(/^\d{6}$/);
    expect(result.verification.expiresAt.getTime()).toBe(clock.getTime() + TTL_MS);

    const row = onlyVerification();
    expect(row.email).toBe('student@example.edu');
    expect(row.status).toBe('PENDING');
    expect(row.codeHash).not.toBe(result.verification.code);
    expect(row.codeHash).toMatch(/^[0-9a-f]{64}$/);
    expect(row.codeSalt).toBeTruthy();
    expect(row.attempts).toBe(0);
  });

  it('invalidates an earlier pending request so only the newest code works', async () => {
    const first = await startVerification(client, { userId: 'u1', email: 'a@example.edu' }, options);
    const second = await startVerification(client, { userId: 'u1', email: 'a@example.edu' }, options);
    if (!first.ok || !second.ok) throw new Error('expected both starts to succeed');

    expect(store.verifications.get(first.verification.id)?.status).toBe('EXPIRED');
    expect(store.verifications.get(second.verification.id)?.status).toBe('PENDING');

    const usingOldCode = await verifyCode(
      client,
      { verificationId: first.verification.id, code: first.verification.code },
      options,
    );
    expect(usingOldCode).toEqual({ ok: false, reason: 'expired' });
  });
});

describe('verifyCode', () => {
  async function start(): Promise<{ id: string; code: string }> {
    const result = await startVerification(client, { userId: 'u1', email: 'a@example.edu' }, options);
    if (!result.ok) throw new Error('expected start to succeed');
    return { id: result.verification.id, code: result.verification.code };
  }

  function wrongCode(actual: string): string {
    return actual === '000000' ? '111111' : '000000';
  }

  it('accepts the emailed code and marks the request verified', async () => {
    const { id, code } = await start();
    const result = await verifyCode(client, { verificationId: id, code }, options);

    expect(result).toEqual({ ok: true, verificationId: id, verifiedAt: clock, accountEmailVerified: false });
    const row = store.verifications.get(id)!;
    expect(row.status).toBe('VERIFIED');
    expect(row.verifiedAt).toEqual(clock);
    expect(row.consumedAt).toEqual(clock);
  });

  it('marks the account email verified when it is the verified address', async () => {
    const user = store.addUser('u1', 'a@example.edu');
    const { id, code } = await start();

    const result = await verifyCode(client, { verificationId: id, code }, options);

    expect(result).toMatchObject({ ok: true, accountEmailVerified: true });
    expect(user.emailVerified).toBe(true);
  });

  it('leaves the account email alone when the user signed up with another address', async () => {
    const user = store.addUser('u1', 'someone@gmail.com');
    const other = store.addUser('u2', 'a@example.edu');
    const { id, code } = await start();

    const result = await verifyCode(client, { verificationId: id, code }, options);

    expect(result).toMatchObject({ ok: true, accountEmailVerified: false });
    expect(user.emailVerified).toBe(false);
    // Another account that owns the address is not the one that proved it.
    expect(other.emailVerified).toBe(false);
  });

  it('does not mark the account email verified on a failed attempt', async () => {
    const user = store.addUser('u1', 'a@example.edu');
    const { id, code } = await start();

    await verifyCode(client, { verificationId: id, code: wrongCode(code) }, options);

    expect(user.emailVerified).toBe(false);
  });

  it('is single use: a redeemed code cannot be replayed', async () => {
    const { id, code } = await start();
    await verifyCode(client, { verificationId: id, code }, options);
    const replay = await verifyCode(client, { verificationId: id, code }, options);

    expect(replay).toEqual({ ok: false, reason: 'already-verified' });
  });

  it('rejects a wrong code and counts the failure', async () => {
    const { id, code } = await start();
    const result = await verifyCode(client, { verificationId: id, code: wrongCode(code) }, options);

    expect(result).toEqual({
      ok: false,
      reason: 'invalid-code',
      attemptsRemaining: MAX_ATTEMPTS - 1,
    });
    const row = store.verifications.get(id)!;
    expect(row.attempts).toBe(1);
    expect(row.status).toBe('PENDING');
  });

  it('locks out after too many wrong codes', async () => {
    const { id, code } = await start();
    const bad = wrongCode(code);

    await verifyCode(client, { verificationId: id, code: bad }, options);
    await verifyCode(client, { verificationId: id, code: bad }, options);
    const third = await verifyCode(client, { verificationId: id, code: bad }, options);

    expect(third).toEqual({ ok: false, reason: 'too-many-attempts' });
    const row = store.verifications.get(id)!;
    expect(row.attempts).toBe(MAX_ATTEMPTS);
    expect(row.status).toBe('EXPIRED');

    const afterwards = await verifyCode(client, { verificationId: id, code }, options);
    expect(afterwards).toEqual({ ok: false, reason: 'expired' });
  });

  it('rejects a code past its expiry and marks it expired', async () => {
    const { id, code } = await start();
    clock = new Date(clock.getTime() + TTL_MS + 1);

    const result = await verifyCode(client, { verificationId: id, code }, options);
    expect(result).toEqual({ ok: false, reason: 'expired' });
    expect(store.verifications.get(id)?.status).toBe('EXPIRED');
  });

  it('returns unknown for an id that does not exist', async () => {
    const result = await verifyCode(client, { verificationId: 'nope', code: '000000' }, options);
    expect(result).toEqual({ ok: false, reason: 'unknown' });
  });
});

describe('requestVerificationCode', () => {
  it('emails the code and returns the pending verification', async () => {
    const mailer = new FakeMailer();

    const result = await requestVerificationCode(
      client,
      { userId: 'u1', email: '  Student@Example.EDU ' },
      { ...options, mailer },
    );

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.email).toBe('student@example.edu');
    expect(result.domain).toBe('example.edu');
    expect(result.type).toBe('EDU');

    expect(mailer.messages).toHaveLength(1);
    const message = mailer.messages[0]!;
    expect(message.to).toBe('student@example.edu');
    expect(message.subject).toContain('HateD');

    // The emailed code is the one that redeems the stored request.
    const code = message.text.match(/\b\d{6}\b/)?.[0];
    expect(code).toBeDefined();
    const verified = await verifyCode(client, { verificationId: result.verificationId, code: code! }, options);
    expect(verified.ok).toBe(true);
  });

  it('does not send anything for an unsupported domain', async () => {
    const mailer = new FakeMailer();

    const result = await requestVerificationCode(
      client,
      { userId: 'u1', email: 'a@unknown.edu' },
      { ...options, mailer },
    );

    expect(result).toEqual({ ok: false, reason: 'unsupported-domain' });
    expect(mailer.messages).toHaveLength(0);
    expect(store.verifications.size).toBe(0);
  });

  it('expires the pending code when delivery fails', async () => {
    const mailer = new FakeMailer();
    mailer.fail = new Error('smtp down');

    const result = await requestVerificationCode(
      client,
      { userId: 'u1', email: 'a@example.edu' },
      { ...options, mailer },
    );

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.reason).toBe('delivery-failed');
    expect(result.error).toBeInstanceOf(Error);
    expect(onlyVerification().status).toBe('EXPIRED');
  });
});
