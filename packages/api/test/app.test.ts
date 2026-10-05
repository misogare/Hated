import type { AccountView } from '@hated/db';
import { describe, expect, it } from 'vitest';

import { createApp, type ApiServices } from '../src/app.js';
import { parseSchedule } from '../src/schedule.js';
import { issueToken } from '../src/tokens.js';

const SECRET = 'a-test-secret-that-is-at-least-32-chars';
const NOW = new Date('2026-10-05T12:00:00Z');

const ACCOUNT: AccountView = {
  userId: 'user-1',
  email: 'sam@vu.edu.au',
  emailVerified: true,
  institution: { name: 'Victoria University', domain: 'vu.edu.au' },
  profile: { displayName: 'Sam', birthDate: '2003-04-20', age: 23, gender: 'woman', seeking: [], isActive: true },
  onboarding: { profile: true, answers: true },
};

/** Every service fails loudly unless a test stubs it. */
function services(overrides: Partial<ApiServices> = {}): ApiServices {
  return new Proxy(overrides as ApiServices, {
    get(target, name: string) {
      return (
        target[name as keyof ApiServices] ??
        (() => {
          throw new Error(`service ${name} was not stubbed`);
        })
      );
    },
  });
}

function app(overrides: Partial<ApiServices> = {}) {
  return createApp({
    services: services(overrides),
    authSecret: SECRET,
    schedule: parseSchedule('SUN', '20:00', 'Australia/Melbourne'),
    now: () => NOW,
  });
}

const bearer = { Authorization: `Bearer ${issueToken('user-1', SECRET, NOW).token}` };

function send(method: string, body?: unknown, headers: Record<string, string> = {}) {
  return {
    method,
    headers: { 'Content-Type': 'application/json', ...headers },
    ...(body === undefined ? {} : { body: typeof body === 'string' ? body : JSON.stringify(body) }),
  };
}

describe('POST /auth/code', () => {
  it('sends a code and returns the verification', async () => {
    const res = await app({
      startSignIn: async (email) => ({ ok: true, verificationId: 'v1', email: email.toLowerCase(), expiresAt: NOW }),
    }).request('/auth/code', send('POST', { email: 'Sam@vu.edu.au' }));

    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ verificationId: 'v1', email: 'sam@vu.edu.au', expiresAt: NOW.toISOString() });
  });

  it('maps each refusal to its status', async () => {
    const cases = [
      [{ ok: false, reason: 'unsupported-domain' }, 422, { error: 'unsupported-domain' }],
      [{ ok: false, reason: 'rate-limited', retryAfterMs: 42_100 }, 429, { error: 'rate-limited', retryAfterSeconds: 43 }],
      [{ ok: false, reason: 'delivery-failed', error: new Error('smtp down') }, 502, { error: 'delivery-failed' }],
    ] as const;
    for (const [result, status, body] of cases) {
      const res = await app({ startSignIn: async () => result }).request('/auth/code', send('POST', { email: 'a@b.co' }));
      expect(res.status).toBe(status);
      expect(await res.json()).toEqual(body);
      if (status === 429) expect(res.headers.get('Retry-After')).toBe('43');
    }
  });

  it('rejects a missing email and broken JSON', async () => {
    const missing = await app().request('/auth/code', send('POST', {}));
    expect(missing.status).toBe(400);
    expect(await missing.json()).toMatchObject({ error: 'invalid-body', problems: [expect.stringContaining('email')] });

    const broken = await app().request('/auth/code', send('POST', '{"email":'));
    expect(broken.status).toBe(400);
    expect(await broken.json()).toEqual({ error: 'invalid-json' });
  });
});

describe('POST /auth/verify', () => {
  it('issues a session for the verified user', async () => {
    const res = await app({
      verifyCode: async () => ({ ok: true, verificationId: 'v1', userId: 'user-1', verifiedAt: NOW, accountEmailVerified: true }),
      getAccount: async () => ACCOUNT,
    }).request('/auth/verify', send('POST', { verificationId: 'v1', code: '123456' }));

    expect(res.status).toBe(200);
    const { token } = (await res.json()) as { token: string };
    const me = await app({ getAccount: async (userId) => ({ ...ACCOUNT, userId }) }).request('/me', {
      headers: { Authorization: `Bearer ${token}` },
    });
    expect(await me.json()).toMatchObject({ userId: 'user-1' });
  });

  it('reports a wrong code with the attempts left, and other failures by reason', async () => {
    const wrong = await app({ verifyCode: async () => ({ ok: false, reason: 'invalid-code', attemptsRemaining: 3 }) }).request(
      '/auth/verify',
      send('POST', { verificationId: 'v1', code: '000000' }),
    );
    expect(wrong.status).toBe(401);
    expect(await wrong.json()).toEqual({ error: 'invalid-code', attemptsRemaining: 3 });

    const expired = await app({ verifyCode: async () => ({ ok: false, reason: 'expired' }) }).request(
      '/auth/verify',
      send('POST', { verificationId: 'v1', code: '000000' }),
    );
    expect(expired.status).toBe(400);
    expect(await expired.json()).toEqual({ error: 'expired' });
  });

  it('rejects a code that is not digits', async () => {
    const res = await app().request('/auth/verify', send('POST', { verificationId: 'v1', code: 'abc' }));
    expect(res.status).toBe(400);
  });
});

describe('authentication', () => {
  it('turns away requests without a valid bearer token', async () => {
    const a = app({ getAccount: async () => ACCOUNT });
    expect((await a.request('/me')).status).toBe(401);
    expect((await a.request('/me', { headers: { Authorization: 'Bearer nonsense' } })).status).toBe(401);
    const otherSecret = issueToken('user-1', 'another-secret-that-is-also-32-chars-long', NOW).token;
    expect((await a.request('/me', { headers: { Authorization: `Bearer ${otherSecret}` } })).status).toBe(401);
  });

  it('treats a token for a deleted account as signed out', async () => {
    const res = await app({ getAccount: async () => null }).request('/me', { headers: bearer });
    expect(res.status).toBe(401);
  });
});

describe('profile routes', () => {
  it('saves a profile with the birthday at UTC midnight and returns the account', async () => {
    let saved: unknown;
    const res = await app({
      saveProfile: async (_userId, input) => {
        saved = input;
        return { ok: true, profileId: 'p1' };
      },
      getAccount: async () => ACCOUNT,
    }).request('/me/profile', send('PUT', { displayName: 'Sam', birthDate: '2003-04-20', gender: 'woman', seeking: [] }, bearer));

    expect(res.status).toBe(200);
    expect(saved).toEqual({ displayName: 'Sam', birthDate: new Date('2003-04-20T00:00:00Z'), gender: 'woman', seeking: [] });
    expect(await res.json()).toEqual(ACCOUNT);
  });

  it('passes validation problems through for the app to show', async () => {
    const res = await app({
      saveProfile: async () => ({ ok: false, reason: 'invalid', problems: ['You need to be 18 or over to use HateD.'] }),
    }).request('/me/profile', send('PUT', { displayName: 'Kid', birthDate: '2012-01-01', gender: 'man', seeking: [] }, bearer));

    expect(res.status).toBe(422);
    expect(await res.json()).toEqual({ error: 'invalid', problems: ['You need to be 18 or over to use HateD.'] });
  });

  it('toggles the next round, or says there is no profile yet', async () => {
    const on = await app({ setProfileActive: async () => true }).request('/me/active', send('PUT', { active: false }, bearer));
    expect(await on.json()).toEqual({ active: false });

    const none = await app({ setProfileActive: async () => false }).request('/me/active', send('PUT', { active: true }, bearer));
    expect(none.status).toBe(409);
  });
});

describe('answers and desires', () => {
  it('saves answers, and maps each failure', async () => {
    const ok = await app({ saveAnswers: async () => ({ ok: true }) }).request(
      '/me/answers',
      send('PUT', { answers: { humor: 0.8, weekend: 'outdoors', ambition: null } }, bearer),
    );
    expect(ok.status).toBe(204);

    const noProfile = await app({ saveAnswers: async () => ({ ok: false, reason: 'no-profile' }) }).request(
      '/me/answers',
      send('PUT', { answers: { humor: 0.8 } }, bearer),
    );
    expect(noProfile.status).toBe(409);

    const badShape = await app().request('/me/answers', send('PUT', { answers: { humor: { nested: true } } }, bearer));
    expect(badShape.status).toBe(400);
  });

  it('reads answers and desires back', async () => {
    const a = app({
      getAnswers: async () => ({ humor: 0.8 }),
      getDesires: async () => ({ humor: { target: 0.9, weight: 1 } }),
    });
    expect(await (await a.request('/me/answers', { headers: bearer })).json()).toEqual({ answers: { humor: 0.8 } });
    expect(await (await a.request('/me/desires', { headers: bearer })).json()).toEqual({
      desires: { humor: { target: 0.9, weight: 1 } },
    });
  });
});

describe('GET /home', () => {
  it('combines the next round, opt-in state and the latest result', async () => {
    const res = await app({
      getAccount: async () => ({ ...ACCOUNT, profile: { ...ACCOUNT.profile!, isActive: false } }),
      getLatestResult: async () => ({ status: 'none' }),
    }).request('/home', { headers: bearer });

    expect(await res.json()).toEqual({ nextRoundAt: '2026-10-11T09:00:00.000Z', isActive: false, result: { status: 'none' } });
  });
});

describe('match actions', () => {
  it('says hello and reports whether it is mutual', async () => {
    const res = await app({ sayHello: async () => ({ ok: true, mutual: true }) }).request('/matches/m1/hello', send('POST', undefined, bearer));
    expect(await res.json()).toEqual({ mutual: true });
  });

  it('maps not-found and passed', async () => {
    const missing = await app({ sayHello: async () => ({ ok: false, reason: 'not-found' }) }).request('/matches/m1/hello', send('POST', undefined, bearer));
    expect(missing.status).toBe(404);
    const passed = await app({ sayHello: async () => ({ ok: false, reason: 'passed' }) }).request('/matches/m1/hello', send('POST', undefined, bearer));
    expect(passed.status).toBe(409);
  });

  it('passes on a match', async () => {
    const res = await app({ passMatch: async () => ({ ok: true, mutual: false }) }).request('/matches/m1/pass', send('POST', undefined, bearer));
    expect(res.status).toBe(204);
  });
});

describe('everything else', () => {
  it('answers unknown routes with JSON', async () => {
    const res = await app().request('/nope');
    expect(res.status).toBe(404);
    expect(await res.json()).toEqual({ error: 'not-found' });
  });

  it('hides internal errors', async () => {
    const res = await app({
      getAccount: async () => {
        throw new Error('database password is hunter2');
      },
    }).request('/me', { headers: bearer });

    expect(res.status).toBe(500);
    expect(await res.text()).not.toContain('hunter2');
  });
});
