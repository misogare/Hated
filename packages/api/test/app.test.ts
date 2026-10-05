import type { AccountView, MatchSummary, Notifier } from '@hated/db';
import { describe, expect, it } from 'vitest';

import { createApp, type ApiServices } from '../src/app.js';
import { parseSchedule } from '../src/schedule.js';

/** The one session the stub knows: it signs in user-1. */
const TOKEN = 'session-token-user-1';
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
    services: services({ resolveSession: async (token) => (token === TOKEN ? 'user-1' : null), ...overrides }),
    schedule: parseSchedule('SUN', '20:00', 'Australia/Melbourne'),
    now: () => NOW,
  });
}

const bearer = { Authorization: `Bearer ${TOKEN}` };

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
    let sessionFor: string | undefined;
    const res = await app({
      verifyCode: async () => ({ ok: true, verificationId: 'v1', userId: 'user-1', verifiedAt: NOW, accountEmailVerified: true }),
      createSession: async (userId) => {
        sessionFor = userId;
        return { token: 'fresh-token', expiresAt: new Date('2026-11-04T12:00:00Z') };
      },
    }).request('/auth/verify', send('POST', { verificationId: 'v1', code: '123456' }));

    expect(res.status).toBe(200);
    expect(sessionFor).toBe('user-1');
    expect(await res.json()).toEqual({ token: 'fresh-token', expiresAt: '2026-11-04T12:00:00.000Z' });
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
    expect((await a.request('/me', { headers: { Authorization: TOKEN } })).status).toBe(401);
  });

  it('signs out this device, or every device', async () => {
    const revoked: string[] = [];
    const a = app({
      revokeSession: async (token) => {
        revoked.push(`device:${token}`);
      },
      revokeAllSessions: async (userId) => {
        revoked.push(`all:${userId}`);
        return 2;
      },
      unregisterAllPushTokens: async (userId) => {
        revoked.push(`devices:${userId}`);
      },
    });

    expect((await a.request('/auth/sign-out', { method: 'POST', headers: bearer })).status).toBe(204);
    expect((await a.request('/auth/sign-out', send('POST', { everywhere: true }, bearer))).status).toBe(204);
    expect(revoked).toEqual([`device:${TOKEN}`, 'all:user-1', 'devices:user-1']);
    expect((await a.request('/auth/sign-out', send('POST', { everywhere: 'yes' }, bearer))).status).toBe(400);
    expect((await a.request('/auth/sign-out', { method: 'POST' })).status).toBe(401);
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
      listMatches: async () => [summary({ unread: 2 }), summary({ unread: 1 })],
    }).request('/home', { headers: bearer });

    expect(await res.json()).toEqual({
      nextRoundAt: '2026-10-11T09:00:00.000Z',
      isActive: false,
      result: { status: 'none' },
      unreadTotal: 3,
    });
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

describe('chat', () => {
  const message = { id: 'msg1', body: 'Hi Maya', sentAt: NOW.toISOString(), mine: true };

  it('lists messages, passing the cursor through', async () => {
    let seenAfter: string | undefined = 'unset';
    const res = await app({
      listMessages: async (_userId, _matchId, after) => {
        seenAfter = after;
        return { ok: true, messages: [message] };
      },
    }).request('/matches/m1/messages?after=msg0', { headers: bearer });

    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ messages: [message] });
    expect(seenAfter).toBe('msg0');
  });

  it('treats an empty cursor as none', async () => {
    let seenAfter: string | undefined = 'unset';
    await app({
      listMessages: async (_userId, _matchId, after) => {
        seenAfter = after;
        return { ok: true, messages: [] };
      },
    }).request('/matches/m1/messages?after=', { headers: bearer });
    expect(seenAfter).toBeUndefined();
  });

  it('sends a message and answers 201 with it', async () => {
    const res = await app({ sendMessage: async (_u, _m, body) => ({ ok: true, message: { ...message, body } }) }).request(
      '/matches/m1/messages',
      send('POST', { body: 'Hi Maya' }, bearer),
    );

    expect(res.status).toBe(201);
    expect(await res.json()).toEqual({ message });
  });

  it('maps a closed conversation to its status', async () => {
    const cases = [
      ['not-found', 404],
      ['not-mutual', 403],
      ['passed', 409],
    ] as const;
    for (const [reason, status] of cases) {
      const res = await app({ listMessages: async () => ({ ok: false, reason }) }).request('/matches/m1/messages', { headers: bearer });
      expect(res.status).toBe(status);
      expect(await res.json()).toEqual({ error: reason });
    }
  });

  it('passes the reason for a refused message through', async () => {
    const res = await app({
      sendMessage: async () => ({ ok: false, reason: 'invalid', problem: 'Write something first.' }),
    }).request('/matches/m1/messages', send('POST', { body: ' ' }, bearer));

    expect(res.status).toBe(422);
    expect(await res.json()).toEqual({ error: 'invalid', problems: ['Write something first.'] });
  });

  it('needs a signed-in user', async () => {
    expect((await app().request('/matches/m1/messages')).status).toBe(401);
  });
});

describe('per-IP limits on sign-in', () => {
  function appFrom(ip: { current: string }, overrides: Partial<ApiServices> = {}) {
    return createApp({
      services: services({ resolveSession: async () => null, ...overrides }),
      schedule: parseSchedule('SUN', '20:00', 'Australia/Melbourne'),
      now: () => NOW,
      clientIp: () => ip.current,
    });
  }

  it('stops one address requesting codes for many inboxes, without affecting others', async () => {
    const ip = { current: '203.0.113.7' };
    let sent = 0;
    const a = appFrom(ip, {
      startSignIn: async (email) => {
        sent++;
        return { ok: true, verificationId: 'v', email, expiresAt: NOW };
      },
    });

    for (let i = 0; i < 5; i++) {
      expect((await a.request('/auth/code', send('POST', { email: `student${i}@vu.edu.au` }))).status).toBe(200);
    }
    const sixth = await a.request('/auth/code', send('POST', { email: 'student6@vu.edu.au' }));
    expect(sixth.status).toBe(429);
    expect(await sixth.json()).toEqual({ error: 'rate-limited', retryAfterSeconds: 60 });
    expect(sixth.headers.get('Retry-After')).toBe('60');
    expect(sent).toBe(5);

    ip.current = '198.51.100.20';
    expect((await a.request('/auth/code', send('POST', { email: 'other@vu.edu.au' }))).status).toBe(200);
  });

  it('limits code guessing per address', async () => {
    const ip = { current: '203.0.113.7' };
    const a = appFrom(ip, { verifyCode: async () => ({ ok: false, reason: 'invalid-code', attemptsRemaining: 4 }) });

    for (let i = 0; i < 20; i++) {
      expect((await a.request('/auth/verify', send('POST', { verificationId: `v${i}`, code: '000000' }))).status).toBe(401);
    }
    expect((await a.request('/auth/verify', send('POST', { verificationId: 'v21', code: '000000' }))).status).toBe(429);
  });
});

function summary(overrides: Partial<MatchSummary> = {}): MatchSummary {
  return {
    matchId: 'm1',
    roundId: 'r1',
    publishedAt: NOW.toISOString(),
    partner: { displayName: 'Maya', age: 23, institution: 'Victoria University' },
    saidHello: true,
    mutual: true,
    passed: false,
    lastMessage: null,
    unread: 0,
    ...overrides,
  };
}

describe('match history and reports', () => {
  it('lists matches', async () => {
    const res = await app({ listMatches: async () => [summary()] }).request('/matches', { headers: bearer });
    expect(await res.json()).toEqual({ matches: [summary()] });
  });

  it('reports a match, mapping refusals', async () => {
    let seen: unknown;
    const ok = await app({
      reportMatch: async (_userId, matchId, input) => {
        seen = { matchId, ...input };
        return { ok: true };
      },
    }).request('/matches/m1/report', send('POST', { reason: 'harassment', details: 'rude' }, bearer));
    expect(ok.status).toBe(204);
    expect(seen).toEqual({ matchId: 'm1', reason: 'harassment', details: 'rude' });

    const invalid = await app({ reportMatch: async () => ({ ok: false, reason: 'invalid', problem: 'Choose a reason.' }) }).request(
      '/matches/m1/report',
      send('POST', { reason: 'boring' }, bearer),
    );
    expect(invalid.status).toBe(422);
    expect(await invalid.json()).toEqual({ error: 'invalid', problems: ['Choose a reason.'] });

    const missing = await app({ reportMatch: async () => ({ ok: false, reason: 'not-found' }) }).request(
      '/matches/m1/report',
      send('POST', { reason: 'spam' }, bearer),
    );
    expect(missing.status).toBe(404);
  });
});

describe('push notifications', () => {
  function recordingNotifier() {
    const calls: string[] = [];
    const notifier: Notifier = {
      messageSent: async (matchId, userId) => {
        calls.push(`message ${matchId} from ${userId}`);
      },
      becameMutual: async (matchId, userId) => {
        calls.push(`mutual ${matchId} by ${userId}`);
      },
      roundPublished: async (roundId) => {
        calls.push(`round ${roundId}`);
      },
    };
    return { calls, notifier };
  }

  function appWith(notifier: Notifier, overrides: Partial<ApiServices>) {
    return createApp({
      services: services({ resolveSession: async (token) => (token === TOKEN ? 'user-1' : null), ...overrides }),
      schedule: parseSchedule('SUN', '20:00', 'Australia/Melbourne'),
      now: () => NOW,
      notifier,
    });
  }

  it('registers this device, and refuses a token that is not an Expo one', async () => {
    let seen: unknown;
    const ok = await app({
      registerPushToken: async (userId, token, platform) => {
        seen = { userId, token, platform };
        return { ok: true };
      },
    }).request('/me/push-token', send('PUT', { token: 'ExponentPushToken[abc]', platform: 'ios' }, bearer));
    expect(ok.status).toBe(204);
    expect(seen).toEqual({ userId: 'user-1', token: 'ExponentPushToken[abc]', platform: 'ios' });

    const bad = await app({ registerPushToken: async () => ({ ok: false, reason: 'invalid' }) }).request(
      '/me/push-token',
      send('PUT', { token: 'nope', platform: 'ios' }, bearer),
    );
    expect(bad.status).toBe(422);
  });

  it("forgets this device's token when it signs out", async () => {
    const forgotten: string[] = [];
    const res = await app({
      revokeSession: async () => undefined,
      unregisterPushToken: async (userId, token) => {
        forgotten.push(`${userId} ${token}`);
      },
    }).request('/auth/sign-out', send('POST', { pushToken: 'ExponentPushToken[abc]' }, bearer));

    expect(res.status).toBe(204);
    expect(forgotten).toEqual(['user-1 ExponentPushToken[abc]']);
  });

  it('notifies the other person about a new message', async () => {
    const { calls, notifier } = recordingNotifier();
    await appWith(notifier, {
      sendMessage: async (_u, _m, body) => ({ ok: true, message: { id: 'msg1', body, sentAt: NOW.toISOString(), mine: true } }),
    }).request('/matches/m1/messages', send('POST', { body: 'Hi' }, bearer));

    expect(calls).toEqual(['message m1 from user-1']);
  });

  it('notifies once, when a hello makes the match mutual', async () => {
    const { calls, notifier } = recordingNotifier();
    const results = [
      { ok: true as const, mutual: false, becameMutual: false },
      { ok: true as const, mutual: true, becameMutual: true },
      { ok: true as const, mutual: true, becameMutual: false },
    ];
    const a = appWith(notifier, { sayHello: async () => results.shift()! });
    for (let i = 0; i < 3; i++) await a.request('/matches/m1/hello', send('POST', undefined, bearer));

    expect(calls).toEqual(['mutual m1 by user-1']);
  });

  it('sends nothing when the message was refused', async () => {
    const { calls, notifier } = recordingNotifier();
    await appWith(notifier, { sendMessage: async () => ({ ok: false, reason: 'passed' }) }).request(
      '/matches/m1/messages',
      send('POST', { body: 'Hi' }, bearer),
    );
    expect(calls).toEqual([]);
  });
});
