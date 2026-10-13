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
  profile: {
    displayName: 'Sam',
    birthDate: '2003-04-20',
    age: 23,
    gender: 'woman',
    seeking: [],
    isActive: true,
    bio: null,
    prompts: [],
    highlights: [],
  },
  photos: [],
  onboarding: { profile: true, answers: true, photos: true },
  notifications: { messages: true, hellos: true, rounds: true },
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
      matchEnded: async (matchId, userId) => {
        calls.push(`ended ${matchId} by ${userId}`);
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

  it('announces an ended match when someone passes or reports, and not when that was refused', async () => {
    const { calls, notifier } = recordingNotifier();
    await appWith(notifier, { passMatch: async () => ({ ok: true, mutual: false }) }).request('/matches/m1/pass', send('POST', undefined, bearer));
    await appWith(notifier, { reportMatch: async () => ({ ok: true }) }).request('/matches/m2/report', send('POST', { reason: 'spam' }, bearer));
    await appWith(notifier, { passMatch: async () => ({ ok: false, reason: 'not-found' }) }).request('/matches/m3/pass', send('POST', undefined, bearer));

    expect(calls).toEqual(['ended m1 by user-1', 'ended m2 by user-1']);
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

describe('privacy', () => {
  it('turns notification kinds on and off, leaving the rest as they are', async () => {
    let seen: unknown;
    const res = await app({
      setNotificationPrefs: async (userId, changes) => {
        seen = { userId, changes };
        return { messages: true, hellos: true, rounds: false };
      },
    }).request('/me/notifications', send('PUT', { rounds: false }, bearer));

    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ messages: true, hellos: true, rounds: false });
    expect(seen).toEqual({ userId: 'user-1', changes: { rounds: false } });
  });

  it('refuses notification settings it does not know', async () => {
    const a = app({ setNotificationPrefs: async () => ({ messages: true, hellos: true, rounds: true }) });
    expect((await a.request('/me/notifications', send('PUT', { marketing: false }, bearer))).status).toBe(400);
    expect((await a.request('/me/notifications', send('PUT', { messages: 'no' }, bearer))).status).toBe(400);
  });

  it('deletes the signed-in account, and only with a session', async () => {
    const deleted: string[] = [];
    const a = app({
      deleteAccount: async (userId) => {
        deleted.push(userId);
        return true;
      },
    });

    expect((await a.request('/me', { method: 'DELETE' })).status).toBe(401);
    const res = await a.request('/me', send('DELETE', undefined, bearer));
    expect(res.status).toBe(204);
    expect(deleted).toEqual(['user-1']);
  });
});

describe('data export', () => {
  const EXPORT = {
    format: 'hated-export' as const,
    version: 1 as const,
    exportedAt: NOW.toISOString(),
    about: 'Everything HateD holds about you.',
    account: { email: 'sam@vu.edu.au', emailVerified: true, createdAt: NOW.toISOString(), notifications: { messages: true, hellos: true, rounds: true } },
    emailVerifications: [],
    profile: null,
    answers: [],
    traits: {},
    hopes: {},
    rounds: [],
    matches: [],
    reportsYouMade: [],
    signIns: [],
    notificationDevices: [],
  };

  it("sends the person's data as a file that is never cached", async () => {
    const asked: string[] = [];
    const res = await app({
      exportAccount: async (userId) => {
        asked.push(userId);
        return EXPORT;
      },
    }).request('/me/export', send('GET', undefined, bearer));

    expect(res.status).toBe(200);
    expect(res.headers.get('cache-control')).toBe('no-store');
    expect(res.headers.get('content-disposition')).toBe(`attachment; filename="hated-data-${NOW.toISOString().slice(0, 10)}.json"`);
    expect(await res.json()).toEqual(EXPORT);
    expect(asked).toEqual(['user-1']);
  });

  it('allows five exports an hour per person', async () => {
    const a = app({ exportAccount: async () => EXPORT });
    for (let i = 0; i < 5; i++) expect((await a.request('/me/export', send('GET', undefined, bearer))).status).toBe(200);

    const sixth = await a.request('/me/export', send('GET', undefined, bearer));
    expect(sixth.status).toBe(429);
    expect(Number(sixth.headers.get('retry-after'))).toBeGreaterThan(0);
  });
});

describe('photos', () => {
  const PHOTO = { id: 'p1', width: 600, height: 750 };
  const JPEG = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 1, 2, 3]);

  function upload(bytes: Uint8Array = JPEG, field = 'photo') {
    const form = new FormData();
    form.append(field, new Blob([bytes], { type: 'image/jpeg' }), 'me.jpg');
    return { method: 'POST', headers: bearer, body: form };
  }

  it('takes an upload as multipart form data and answers with every photo', async () => {
    let received: Buffer | undefined;
    const res = await app({
      addPhoto: async (_userId, bytes) => {
        received = bytes;
        return { ok: true, photo: PHOTO };
      },
      listPhotos: async () => [PHOTO],
    }).request('/me/photos', upload());

    expect(res.status).toBe(201);
    expect(await res.json()).toEqual({ photos: [PHOTO] });
    expect(received?.equals(JPEG)).toBe(true);
  });

  it('says why an upload was refused', async () => {
    const refusals = [
      [{ ok: false, reason: 'invalid', problem: 'That photo is too small.' }, 422, { error: 'invalid', problems: ['That photo is too small.'] }],
      [{ ok: false, reason: 'too-many' }, 409, { error: 'too-many', problems: ['Six photos at most. Remove one to add another.'] }],
      [{ ok: false, reason: 'no-profile' }, 409, { error: 'no-profile' }],
    ] as const;
    for (const [result, status, body] of refusals) {
      const res = await app({ addPhoto: async () => result }).request('/me/photos', upload());
      expect(res.status).toBe(status);
      expect(await res.json()).toEqual(body);
    }

    expect((await app().request('/me/photos', upload(JPEG, 'picture'))).status).toBe(400);
    expect((await app().request('/me/photos', send('POST', { photo: 'base64?' }, bearer))).status).toBe(400);
    expect((await app().request('/me/photos', { method: 'POST', body: new FormData() })).status).toBe(401);
  });

  it('refuses an upload over 15 MB before reading it', async () => {
    const res = await app().request('/me/photos', upload(new Uint8Array(16 * 1024 * 1024)));
    expect(res.status).toBe(413);
    expect(await res.json()).toMatchObject({ error: 'too-large' });
  });

  it('allows thirty uploads an hour per person', async () => {
    const a = app({ addPhoto: async () => ({ ok: true, photo: PHOTO }), listPhotos: async () => [PHOTO] });
    for (let i = 0; i < 30; i++) expect((await a.request('/me/photos', upload())).status).toBe(201);
    expect((await a.request('/me/photos', upload())).status).toBe(429);
  });

  it('removes and reorders photos, answering with the new list', async () => {
    const removed = await app({ deletePhoto: async (_u, id) => id === 'p1', listPhotos: async () => [] }).request('/me/photos/p1', {
      method: 'DELETE',
      headers: bearer,
    });
    expect(removed.status).toBe(200);
    expect(await removed.json()).toEqual({ photos: [] });
    expect((await app({ deletePhoto: async () => false }).request('/me/photos/nope', { method: 'DELETE', headers: bearer })).status).toBe(404);

    let order: string[] = [];
    const reordered = await app({
      reorderPhotos: async (_u, ids) => {
        order = ids;
        return { ok: true, photos: [PHOTO] };
      },
    }).request('/me/photos/order', send('PUT', { ids: ['p2', 'p1'] }, bearer));
    expect(reordered.status).toBe(200);
    expect(order).toEqual(['p2', 'p1']);
    const refused = await app({ reorderPhotos: async () => ({ ok: false, reason: 'invalid' }) }).request(
      '/me/photos/order',
      send('PUT', { ids: ['p1'] }, bearer),
    );
    expect(refused.status).toBe(422);
  });

  it('serves a photo only to someone allowed to see that version, and never caches it publicly', async () => {
    const asked: string[] = [];
    const a = app({
      readPhoto: async (userId, photoId, variant) => {
        asked.push(`${userId} ${photoId} ${variant}`);
        return variant === 'blurred' ? JPEG : null;
      },
    });

    const blurred = await a.request('/photos/p1/blurred', { headers: bearer });
    expect(blurred.status).toBe(200);
    expect(blurred.headers.get('content-type')).toBe('image/jpeg');
    expect(blurred.headers.get('cache-control')).toBe('private, max-age=3600');
    expect(Buffer.from(await blurred.arrayBuffer()).equals(JPEG)).toBe(true);

    expect((await a.request('/photos/p1/full', { headers: bearer })).status).toBe(404);
    expect((await a.request('/photos/p1/original', { headers: bearer })).status).toBe(404);
    expect((await a.request('/photos/p1/blurred')).status).toBe(401);
    expect(asked).toEqual(['user-1 p1 blurred', 'user-1 p1 full']);
  });
});

describe('words and prompts', () => {
  it('saves a line and prompt answers, or says what is wrong', async () => {
    const words = { bio: 'Bookshop on Sunday.', prompts: [{ key: 'perfect-sunday', label: 'A perfect Sunday', answer: 'Market.' }] };
    let input: unknown;
    const ok = await app({
      saveWords: async (_u, value) => {
        input = value;
        return { ok: true, words };
      },
    }).request('/me/words', send('PUT', { bio: 'Bookshop on Sunday.', prompts: [{ key: 'perfect-sunday', answer: 'Market.' }] }, bearer));
    expect(ok.status).toBe(200);
    expect(await ok.json()).toEqual(words);
    expect(input).toEqual({ bio: 'Bookshop on Sunday.', prompts: [{ key: 'perfect-sunday', answer: 'Market.' }] });

    const invalid = await app({ saveWords: async () => ({ ok: false, reason: 'invalid', problems: ['Choose up to 3 prompts.'] }) }).request(
      '/me/words',
      send('PUT', { bio: null, prompts: [] }, bearer),
    );
    expect(invalid.status).toBe(422);
    expect(await invalid.json()).toEqual({ error: 'invalid', problems: ['Choose up to 3 prompts.'] });
    const noProfile = app({ saveWords: async () => ({ ok: false, reason: 'no-profile' }) });
    expect((await noProfile.request('/me/words', send('PUT', { bio: null, prompts: [] }, bearer))).status).toBe(409);
    expect((await app().request('/me/words', send('PUT', { bio: 3, prompts: [] }, bearer))).status).toBe(400);
  });

  it('lists the prompts the app offers', async () => {
    const res = await app({ promptChoices: () => [{ key: 'perfect-sunday', label: 'A perfect Sunday' }] }).request('/prompts', { headers: bearer });
    expect(await res.json()).toEqual({ prompts: [{ key: 'perfect-sunday', label: 'A perfect Sunday' }] });
  });
});

describe('GET /matches/:id', () => {
  it("returns one of the person's matches, and nobody else's", async () => {
    const detail = { roundId: 'r1', publishedAt: NOW.toISOString(), match: { matchId: 'm1' } } as never;
    const a = app({ getMatch: async (_u, matchId) => (matchId === 'm1' ? detail : null) });

    const found = await a.request('/matches/m1', { headers: bearer });
    expect(found.status).toBe(200);
    expect(await found.json()).toEqual(detail);
    expect((await a.request('/matches/m2', { headers: bearer })).status).toBe(404);
  });
});

describe('the window to say hello', () => {
  it('refuses a hello once the time is up', async () => {
    const res = await app({ sayHello: async () => ({ ok: false, reason: 'expired' }) }).request('/matches/m1/hello', send('POST', undefined, bearer));
    expect(res.status).toBe(409);
    expect(await res.json()).toEqual({ error: 'expired' });
  });
});
