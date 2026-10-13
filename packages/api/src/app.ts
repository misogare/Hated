/**
 * The HTTP API the app talks to. Routes are thin: validate the body, call one
 * service, map its typed result to a status code and a `contract.ts` shape.
 *
 * Services are injected (`ApiServices`), so tests drive every route with plain
 * stubs and `server.ts` wires the real `@hated/db` functions.
 */

import type {
  AccountExport,
  AccountView,
  AddPhotoResult,
  AnswerValue,
  DesireInput,
  ListMessagesResult,
  MatchDetail,
  MatchSummary,
  Notifier,
  MatchActionResult,
  NewSession,
  NotificationPrefs,
  PhotoVariant,
  PhotoView,
  ProfileInput,
  RegisterPushTokenResult,
  ReorderPhotosResult,
  ReportResult,
  QuestionnaireView,
  RoundResultView,
  SaveProfileResult,
  SaveResult,
  SaveWordsResult,
  SendMessageResult,
  StartSignInResult,
  VerifyCodeResult,
  WordsInput,
} from '@hated/db';
import { Hono, type Context } from 'hono';
import { bodyLimit } from 'hono/body-limit';
import { cors } from 'hono/cors';
import { createMiddleware } from 'hono/factory';
import { z } from 'zod';

import type * as Api from './contract.js';
import { createRateLimiter, type RateLimiter } from './rate-limit.js';
import { nextRoundAt, type RoundSchedule } from './schedule.js';

export interface ApiServices {
  startSignIn(email: string): Promise<StartSignInResult>;
  verifyCode(input: { verificationId: string; code: string }): Promise<VerifyCodeResult>;
  createSession(userId: string): Promise<NewSession>;
  /** The user a session token signs in, or null. */
  resolveSession(token: string): Promise<string | null>;
  revokeSession(token: string): Promise<void>;
  revokeAllSessions(userId: string): Promise<number>;
  getAccount(userId: string): Promise<AccountView | null>;
  saveProfile(userId: string, input: ProfileInput): Promise<SaveProfileResult>;
  setProfileActive(userId: string, active: boolean): Promise<boolean>;
  getQuestionnaire(): Promise<QuestionnaireView | null>;
  getAnswers(userId: string): Promise<Record<string, AnswerValue>>;
  saveAnswers(userId: string, answers: Record<string, AnswerValue>): Promise<SaveResult>;
  getDesires(userId: string): Promise<Record<string, DesireInput>>;
  saveDesires(userId: string, desires: Record<string, DesireInput>): Promise<SaveResult>;
  getLatestResult(userId: string): Promise<RoundResultView>;
  sayHello(userId: string, matchId: string): Promise<MatchActionResult>;
  passMatch(userId: string, matchId: string): Promise<MatchActionResult>;
  listMessages(userId: string, matchId: string, after?: string): Promise<ListMessagesResult>;
  sendMessage(userId: string, matchId: string, body: string): Promise<SendMessageResult>;
  listMatches(userId: string): Promise<MatchSummary[]>;
  reportMatch(userId: string, matchId: string, input: { reason: string; details?: string }): Promise<ReportResult>;
  registerPushToken(userId: string, token: string, platform: string): Promise<RegisterPushTokenResult>;
  unregisterPushToken(userId: string, token: string): Promise<void>;
  unregisterAllPushTokens(userId: string): Promise<void>;
  /** Null if there is no such account. */
  setNotificationPrefs(userId: string, changes: Partial<NotificationPrefs>): Promise<NotificationPrefs | null>;
  /** Erase the account and everything in it. False if there was no such account. */
  deleteAccount(userId: string): Promise<boolean>;
  /** Everything about the account, or null if there is no such account. */
  exportAccount(userId: string): Promise<AccountExport | null>;
  listPhotos(userId: string): Promise<PhotoView[]>;
  addPhoto(userId: string, upload: Buffer): Promise<AddPhotoResult>;
  /** False if it isn't theirs. */
  deletePhoto(userId: string, photoId: string): Promise<boolean>;
  reorderPhotos(userId: string, ids: string[]): Promise<ReorderPhotosResult>;
  /** The bytes of that version of the photo, if this person may see it; otherwise null. */
  readPhoto(userId: string, photoId: string, variant: PhotoVariant): Promise<Buffer | null>;
  saveWords(userId: string, input: WordsInput): Promise<SaveWordsResult>;
  /** The prompts the app offers. */
  promptChoices(): Array<{ key: string; label: string }>;
  /** One of the person's matches, from any published round; null if it isn't theirs. */
  getMatch(userId: string, matchId: string): Promise<MatchDetail | null>;
}

export interface ApiOptions {
  services: ApiServices;
  schedule: RoundSchedule;
  /** Injectable clock, for tests. */
  now?: () => Date;
  /**
   * The caller's IP, for per-IP limits on sign-in. The server reads the socket
   * (or X-Forwarded-For behind a trusted proxy); without one, every caller
   * shares a single bucket.
   */
  clientIp?: (c: Context) => string;
  /** Sends push notifications for messages and mutual hellos. Default: none. */
  notifier?: Notifier;
}

const SILENT: Notifier = {
  messageSent: async () => undefined,
  becameMutual: async () => undefined,
  roundPublished: async () => undefined,
};

/**
 * Per-IP limits on sign-in. Codes: enough for a household or a shared campus
 * network, far too few to walk through many addresses. Verifying: generous for
 * typos, tight enough to stop guessing across many codes.
 */
const SEND_CODE_LIMITS = [
  { limit: 5, windowMs: 60_000 },
  { limit: 30, windowMs: 60 * 60_000 },
];
const VERIFY_CODE_LIMITS = [
  { limit: 20, windowMs: 60_000 },
  { limit: 100, windowMs: 60 * 60_000 },
];
/** Per person: an export reads the whole account, and nobody needs one a minute. */
const EXPORT_LIMITS = [{ limit: 5, windowMs: 60 * 60_000 }];
/** Per person: plenty for trying photos out, few enough to keep processing cheap. */
const UPLOAD_LIMITS = [{ limit: 30, windowMs: 60 * 60_000 }];
/** An upload's size, with room for the form around it. The service checks the photo itself. */
const MAX_UPLOAD_BODY = 15 * 1024 * 1024 + 64 * 1024;

type Env = { Variables: { userId: string; token: string } };

const SendCodeBody = z.object({ email: z.string().trim().min(3).max(254) });
const VerifyCodeBody = z.object({
  verificationId: z.string().min(1).max(64),
  code: z.string().trim().regex(/^\d{4,10}$/),
});
const ProfileBody = z.object({
  displayName: z.string().max(100),
  birthDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  gender: z.string().max(100),
  seeking: z.array(z.string().max(100)).max(20),
});
const ActiveBody = z.object({ active: z.boolean() });
const SignOutBody = z.object({ everywhere: z.boolean().optional(), pushToken: z.string().max(300).optional() });
const PushTokenBody = z.object({ token: z.string().max(300), platform: z.string().max(20) });
const NotificationsBody = z.strictObject({ messages: z.boolean().optional(), hellos: z.boolean().optional(), rounds: z.boolean().optional() });
const Key = z.string().min(1).max(64);
const AnswersBody = z.object({
  answers: z.record(Key, z.union([z.number(), z.string().max(200), z.null()])),
});
// The service enforces the real limit (2000); this only stops absurd payloads early.
const MessageBody = z.object({ body: z.string().max(10_000) });
// The service checks the reason against its list and the real length limit.
const ReportBody = z.object({ reason: z.string().max(40), details: z.string().max(5_000).optional() });
const DesiresBody = z.object({
  desires: z.record(Key, z.object({ target: z.number(), weight: z.number() })),
});
// The service checks the real lengths and the prompt keys.
const WordsBody = z.object({
  bio: z.string().max(1_000).nullable(),
  prompts: z.array(z.object({ key: Key, answer: z.string().max(2_000) })).max(10),
});
const PhotoOrderBody = z.object({ ids: z.array(z.string().min(1).max(64)).max(10) });

export function createApp(options: ApiOptions): Hono<Env> {
  const { services, schedule } = options;
  const now = options.now ?? (() => new Date());
  const clientIp = options.clientIp ?? (() => 'unknown');
  const notifier = options.notifier ?? SILENT;
  const clock = () => now().getTime();
  const sendCodeLimiter = createRateLimiter(SEND_CODE_LIMITS, clock);
  const verifyCodeLimiter = createRateLimiter(VERIFY_CODE_LIMITS, clock);
  const exportLimiter = createRateLimiter(EXPORT_LIMITS, clock);
  const uploadLimiter = createRateLimiter(UPLOAD_LIMITS, clock);
  const app = new Hono<Env>();

  /** 429 with Retry-After when this caller (by IP, or by `key`) is over the limit, else null. */
  function limited(c: Context, limiter: RateLimiter, key: string = clientIp(c)): Response | null {
    const result = limiter.check(key);
    if (result.ok) return null;
    const retryAfterSeconds = Math.ceil(result.retryAfterMs / 1000);
    c.header('Retry-After', String(retryAfterSeconds));
    return c.json<Api.ApiError>({ error: 'rate-limited', retryAfterSeconds }, 429);
  }

  // Sessions are bearer tokens, never cookies, so any origin may call (Expo web in dev).
  app.use('*', cors());

  app.onError((error, c) => {
    console.error(error);
    return c.json<Api.ApiError>({ error: 'internal' }, 500);
  });
  app.notFound((c) => c.json<Api.ApiError>({ error: 'not-found' }, 404));

  const requireUser = createMiddleware<Env>(async (c, next) => {
    const header = c.req.header('authorization') ?? '';
    const token = header.startsWith('Bearer ') ? header.slice('Bearer '.length).trim() : '';
    const userId = token.length > 0 ? await services.resolveSession(token) : null;
    if (userId === null) return c.json<Api.ApiError>({ error: 'unauthorized' }, 401);
    c.set('userId', userId);
    c.set('token', token);
    await next();
  });

  app.get('/health', (c) => c.json({ ok: true }));

  // --- Sign-in ---------------------------------------------------------------

  app.post('/auth/code', async (c) => {
    const tooMany = limited(c, sendCodeLimiter);
    if (tooMany !== null) return tooMany;
    const body = await readBody(c, SendCodeBody);
    if (!body.ok) return body.response;

    const result = await services.startSignIn(body.value.email);
    if (result.ok) {
      return c.json<Api.SendCodeResponse>({
        verificationId: result.verificationId,
        email: result.email,
        expiresAt: result.expiresAt.toISOString(),
      });
    }
    switch (result.reason) {
      case 'unsupported-domain':
        return c.json<Api.ApiError>({ error: 'unsupported-domain' }, 422);
      case 'rate-limited': {
        const retryAfterSeconds = Math.ceil(result.retryAfterMs / 1000);
        c.header('Retry-After', String(retryAfterSeconds));
        return c.json<Api.ApiError>({ error: 'rate-limited', retryAfterSeconds }, 429);
      }
      case 'delivery-failed':
        console.error('sign-in code delivery failed', result.error);
        return c.json<Api.ApiError>({ error: 'delivery-failed' }, 502);
    }
  });

  app.post('/auth/verify', async (c) => {
    const tooMany = limited(c, verifyCodeLimiter);
    if (tooMany !== null) return tooMany;
    const body = await readBody(c, VerifyCodeBody);
    if (!body.ok) return body.response;

    const result = await services.verifyCode(body.value);
    if (!result.ok) {
      return result.reason === 'invalid-code'
        ? c.json<Api.ApiError>({ error: 'invalid-code', attemptsRemaining: result.attemptsRemaining ?? 0 }, 401)
        : c.json<Api.ApiError>({ error: result.reason }, 400);
    }
    const session = await services.createSession(result.userId);
    return c.json<Api.SessionResponse>({ token: session.token, expiresAt: session.expiresAt.toISOString() });
  });

  app.post('/auth/sign-out', requireUser, async (c) => {
    // An empty body means "just this device".
    const raw = await c.req.text();
    const parsed = SignOutBody.safeParse(raw.trim().length === 0 ? {} : safeJson(raw));
    if (!parsed.success) return c.json<Api.ApiError>({ error: 'invalid-body' }, 400);

    const userId = c.get('userId');
    if (parsed.data.everywhere === true) {
      await services.revokeAllSessions(userId);
      await services.unregisterAllPushTokens(userId);
    } else {
      await services.revokeSession(c.get('token'));
      if (parsed.data.pushToken !== undefined) await services.unregisterPushToken(userId, parsed.data.pushToken);
    }
    return c.body(null, 204);
  });

  app.put('/me/push-token', requireUser, async (c) => {
    const body = await readBody(c, PushTokenBody);
    if (!body.ok) return body.response;

    const result = await services.registerPushToken(c.get('userId'), body.value.token, body.value.platform);
    if (!result.ok) return c.json<Api.ApiError>({ error: 'invalid', problems: ['Not an Expo push token for iOS or Android.'] }, 422);
    return c.body(null, 204);
  });

  // --- Account and profile ---------------------------------------------------

  app.get('/me', requireUser, async (c) => {
    const account = await services.getAccount(c.get('userId'));
    if (account === null) return c.json<Api.ApiError>({ error: 'unauthorized' }, 401);
    return c.json<Api.Account>(account);
  });

  app.put('/me/profile', requireUser, async (c) => {
    const body = await readBody(c, ProfileBody);
    if (!body.ok) return body.response;

    const userId = c.get('userId');
    const result = await services.saveProfile(userId, {
      ...body.value,
      birthDate: new Date(`${body.value.birthDate}T00:00:00Z`),
    });
    if (!result.ok) return c.json<Api.ApiError>({ error: 'invalid', problems: result.problems }, 422);
    const account = await services.getAccount(userId);
    if (account === null) return c.json<Api.ApiError>({ error: 'unauthorized' }, 401);
    return c.json<Api.Account>(account);
  });

  // Access and portability: a copy of everything about the person, built fresh
  // each time. Personal data, so never cached along the way.
  app.get('/me/export', requireUser, async (c) => {
    const userId = c.get('userId');
    const tooMany = limited(c, exportLimiter, userId);
    if (tooMany !== null) return tooMany;

    const data = await services.exportAccount(userId);
    if (data === null) return c.json<Api.ApiError>({ error: 'unauthorized' }, 401);
    c.header('Cache-Control', 'no-store');
    c.header('Content-Disposition', `attachment; filename="hated-data-${data.exportedAt.slice(0, 10)}.json"`);
    return c.json<Api.DataExport>(data);
  });

  app.put('/me/notifications', requireUser, async (c) => {
    const body = await readBody(c, NotificationsBody);
    if (!body.ok) return body.response;

    const prefs = await services.setNotificationPrefs(c.get('userId'), body.value);
    if (prefs === null) return c.json<Api.ApiError>({ error: 'unauthorized' }, 401);
    return c.json<Api.NotificationPrefs>(prefs);
  });

  // Erasure: the account and everything in it, for good. Every session goes
  // with it, so this token stops working too.
  app.delete('/me', requireUser, async (c) => {
    await services.deleteAccount(c.get('userId'));
    return c.body(null, 204);
  });

  app.put('/me/active', requireUser, async (c) => {
    const body = await readBody(c, ActiveBody);
    if (!body.ok) return body.response;

    const updated = await services.setProfileActive(c.get('userId'), body.value.active);
    if (!updated) return c.json<Api.ApiError>({ error: 'no-profile' }, 409);
    return c.json<Api.ActiveRequest>({ active: body.value.active });
  });

  // --- Photos and words ------------------------------------------------------

  app.get('/me/photos', requireUser, async (c) =>
    c.json<Api.PhotosResponse>({ photos: await services.listPhotos(c.get('userId')) }),
  );

  app.post(
    '/me/photos',
    requireUser,
    bodyLimit({
      maxSize: MAX_UPLOAD_BODY,
      onError: (c) => c.json<Api.ApiError>({ error: 'too-large', problems: ['That photo is too big. Try one under 15 MB.'] }, 413),
    }),
    async (c) => {
      const userId = c.get('userId');
      const tooMany = limited(c, uploadLimiter, userId);
      if (tooMany !== null) return tooMany;

      const form = await c.req.parseBody().catch(() => null);
      const photo = form?.['photo'];
      if (!(photo instanceof File)) {
        return c.json<Api.ApiError>({ error: 'invalid-body', problems: ['Send the photo as multipart form data, in a "photo" field.'] }, 400);
      }

      const result = await services.addPhoto(userId, Buffer.from(await photo.arrayBuffer()));
      if (result.ok) return c.json<Api.PhotosResponse>({ photos: await services.listPhotos(userId) }, 201);
      if (result.reason === 'invalid') return c.json<Api.ApiError>({ error: 'invalid', problems: [result.problem] }, 422);
      if (result.reason === 'too-many') {
        return c.json<Api.ApiError>({ error: 'too-many', problems: ['Six photos at most. Remove one to add another.'] }, 409);
      }
      return c.json<Api.ApiError>({ error: 'no-profile' }, 409);
    },
  );

  app.put('/me/photos/order', requireUser, async (c) => {
    const body = await readBody(c, PhotoOrderBody);
    if (!body.ok) return body.response;

    const result = await services.reorderPhotos(c.get('userId'), body.value.ids);
    if (!result.ok) return c.json<Api.ApiError>({ error: 'invalid', problems: ['List each of your photos once.'] }, 422);
    return c.json<Api.PhotosResponse>({ photos: result.photos });
  });

  app.delete('/me/photos/:photoId', requireUser, async (c) => {
    const userId = c.get('userId');
    if (!(await services.deletePhoto(userId, c.req.param('photoId')))) return c.json<Api.ApiError>({ error: 'not-found' }, 404);
    return c.json<Api.PhotosResponse>({ photos: await services.listPhotos(userId) });
  });

  // A photo someone may not see is simply not found, so ids reveal nothing.
  app.get('/photos/:photoId/:variant', requireUser, async (c) => {
    const variant = c.req.param('variant');
    if (variant !== 'full' && variant !== 'blurred') return c.json<Api.ApiError>({ error: 'not-found' }, 404);
    const bytes = await services.readPhoto(c.get('userId'), c.req.param('photoId'), variant);
    if (bytes === null) return c.json<Api.ApiError>({ error: 'not-found' }, 404);

    c.header('Content-Type', 'image/jpeg');
    // Only for this person, and only for a while: access ends when a match does.
    c.header('Cache-Control', 'private, max-age=3600');
    return c.body(new Uint8Array(bytes));
  });

  app.get('/prompts', requireUser, (c) => c.json<Api.PromptsResponse>({ prompts: services.promptChoices() }));

  app.put('/me/words', requireUser, async (c) => {
    const body = await readBody(c, WordsBody);
    if (!body.ok) return body.response;

    const result = await services.saveWords(c.get('userId'), body.value);
    if (result.ok) return c.json<Api.WordsResponse>(result.words);
    return result.reason === 'no-profile'
      ? c.json<Api.ApiError>({ error: 'no-profile' }, 409)
      : c.json<Api.ApiError>({ error: 'invalid', problems: result.problems }, 422);
  });

  // --- Questionnaire ---------------------------------------------------------

  app.get('/questionnaire', requireUser, async (c) => {
    const questionnaire = await services.getQuestionnaire();
    if (questionnaire === null) return c.json<Api.ApiError>({ error: 'not-found' }, 404);
    return c.json<Api.Questionnaire>(questionnaire);
  });

  app.get('/me/answers', requireUser, async (c) =>
    c.json<Api.AnswersBody>({ answers: await services.getAnswers(c.get('userId')) }),
  );

  app.put('/me/answers', requireUser, async (c) => {
    const body = await readBody(c, AnswersBody);
    if (!body.ok) return body.response;
    return saved(c, await services.saveAnswers(c.get('userId'), body.value.answers));
  });

  app.get('/me/desires', requireUser, async (c) =>
    c.json<Api.DesiresBody>({ desires: await services.getDesires(c.get('userId')) }),
  );

  app.put('/me/desires', requireUser, async (c) => {
    const body = await readBody(c, DesiresBody);
    if (!body.ok) return body.response;
    return saved(c, await services.saveDesires(c.get('userId'), body.value.desires));
  });

  // --- Rounds ----------------------------------------------------------------

  app.get('/home', requireUser, async (c) => {
    const userId = c.get('userId');
    const [account, result, matches] = await Promise.all([
      services.getAccount(userId),
      services.getLatestResult(userId),
      services.listMatches(userId),
    ]);
    if (account === null) return c.json<Api.ApiError>({ error: 'unauthorized' }, 401);
    return c.json<Api.Home>({
      nextRoundAt: nextRoundAt(now(), schedule).toISOString(),
      isActive: account.profile?.isActive ?? false,
      result,
      unreadTotal: matches.reduce((total, match) => total + match.unread, 0),
    });
  });

  app.get('/matches', requireUser, async (c) =>
    c.json<Api.MatchesResponse>({ matches: await services.listMatches(c.get('userId')) }),
  );

  app.get('/matches/:matchId', requireUser, async (c) => {
    const detail = await services.getMatch(c.get('userId'), c.req.param('matchId'));
    if (detail === null) return c.json<Api.ApiError>({ error: 'not-found' }, 404);
    return c.json<Api.MatchDetail>(detail);
  });

  app.post('/matches/:matchId/report', requireUser, async (c) => {
    const body = await readBody(c, ReportBody);
    if (!body.ok) return body.response;

    const result = await services.reportMatch(c.get('userId'), c.req.param('matchId'), body.value);
    if (result.ok) return c.body(null, 204);
    return result.reason === 'not-found'
      ? c.json<Api.ApiError>({ error: 'not-found' }, 404)
      : c.json<Api.ApiError>({ error: 'invalid', problems: [result.problem] }, 422);
  });

  app.post('/matches/:matchId/hello', requireUser, async (c) => {
    const userId = c.get('userId');
    const matchId = c.req.param('matchId');
    const result = await services.sayHello(userId, matchId);
    if (!result.ok) return matchActionError(c, result.reason);
    // Notifications never hold up (or fail) the response.
    if (result.becameMutual === true) void notifier.becameMutual(matchId, userId);
    return c.json<Api.HelloResponse>({ mutual: result.mutual });
  });

  app.post('/matches/:matchId/pass', requireUser, async (c) => {
    const result = await services.passMatch(c.get('userId'), c.req.param('matchId'));
    if (!result.ok) return matchActionError(c, result.reason);
    return c.body(null, 204);
  });

  // --- Chat ------------------------------------------------------------------

  app.get('/matches/:matchId/messages', requireUser, async (c) => {
    const after = c.req.query('after');
    const result = await services.listMessages(c.get('userId'), c.req.param('matchId'), after || undefined);
    if (!result.ok) return chatClosed(c, result.reason);
    return c.json<Api.MessagesResponse>({ messages: result.messages });
  });

  app.post('/matches/:matchId/messages', requireUser, async (c) => {
    const body = await readBody(c, MessageBody);
    if (!body.ok) return body.response;

    const userId = c.get('userId');
    const matchId = c.req.param('matchId');
    const result = await services.sendMessage(userId, matchId, body.value.body);
    if (result.ok) {
      void notifier.messageSent(matchId, userId);
      return c.json<Api.SendMessageResponse>({ message: result.message }, 201);
    }
    if (result.reason === 'invalid') return c.json<Api.ApiError>({ error: 'invalid', problems: [result.problem] }, 422);
    return chatClosed(c, result.reason);
  });

  return app;
}

/** Not on the match: 404; not both said hello yet: 403; someone passed: 409. */
function chatClosed(c: Context, reason: 'not-found' | 'not-mutual' | 'passed'): Response {
  const status = { 'not-found': 404, 'not-mutual': 403, passed: 409 } as const;
  return c.json<Api.ApiError>({ error: reason }, status[reason]);
}

/** Parse and validate a JSON body; on failure, the 400 response to return. */
async function readBody<T>(
  c: Context,
  schema: z.ZodType<T>,
): Promise<{ ok: true; value: T } | { ok: false; response: Response }> {
  let json: unknown;
  try {
    json = await c.req.json();
  } catch {
    return { ok: false, response: c.json<Api.ApiError>({ error: 'invalid-json' }, 400) };
  }
  const parsed = schema.safeParse(json);
  if (!parsed.success) {
    const problems = parsed.error.issues.map((issue) => `${issue.path.join('.') || 'body'}: ${issue.message}`);
    return { ok: false, response: c.json<Api.ApiError>({ error: 'invalid-body', problems }, 400) };
  }
  return { ok: true, value: parsed.data };
}

function safeJson(text: string): unknown {
  try {
    return JSON.parse(text);
  } catch {
    return undefined;
  }
}

function saved(c: Context, result: SaveResult): Response {
  if (result.ok) return c.body(null, 204);
  return result.reason === 'no-profile'
    ? c.json<Api.ApiError>({ error: 'no-profile' }, 409)
    : c.json<Api.ApiError>({ error: 'invalid', problems: result.problems }, 422);
}

function matchActionError(c: Context, reason: 'not-found' | 'passed'): Response {
  return reason === 'not-found'
    ? c.json<Api.ApiError>({ error: 'not-found' }, 404)
    : c.json<Api.ApiError>({ error: 'passed' }, 409);
}
