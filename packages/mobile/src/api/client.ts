/**
 * Typed calls to `@hated/api`. Request and response shapes come straight from
 * the API's `contract.ts` (type-only, so no server code is bundled).
 */

import type * as Api from '@hated/api/contract';
import Constants from 'expo-constants';
import { Platform } from 'react-native';

/** A failed call. `code` is the API's error code, or `network` when it was unreachable. */
export class ApiError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    readonly body: Api.ApiError | null,
  ) {
    super(`${status} ${code}`);
  }
}

/**
 * The API's address: `EXPO_PUBLIC_API_URL` when set, otherwise the machine
 * running the Expo dev server (so a phone on the same Wi-Fi finds it) on port 3000.
 */
export function apiBaseUrl(): string {
  const configured = process.env.EXPO_PUBLIC_API_URL?.trim();
  if (configured) return configured.replace(/\/+$/, '');
  const devHost = Constants.expoConfig?.hostUri?.split(':')[0];
  if (devHost) return `http://${devHost}:3000`;
  return Platform.OS === 'android' ? 'http://10.0.2.2:3000' : 'http://localhost:3000';
}

/** What expo-image needs to fetch a photo: its address and this session's token. */
export interface PhotoSource {
  uri: string;
  headers: Record<string, string>;
  cacheKey: string;
}

export interface ApiClient {
  sendCode(email: string): Promise<Api.SendCodeResponse>;
  verifyCode(verificationId: string, code: string): Promise<Api.SessionResponse>;
  /**
   * End this device's session on the server, or with `everywhere`, every
   * session. `pushToken` stops this device's notifications too.
   */
  signOut(request?: Api.SignOutRequest): Promise<void>;
  /** This device can receive push notifications. */
  registerPushToken(token: string, platform: Api.PushTokenRequest['platform']): Promise<void>;
  me(): Promise<Api.Account>;
  /** Erase the account and everything in it, for good. */
  deleteAccount(): Promise<void>;
  /** Everything HateD holds about the person, as one document. */
  exportData(): Promise<Api.DataExport>;
  /** Turn kinds of push notification on or off; returns all of them. */
  setNotifications(changes: Api.NotificationsRequest): Promise<Api.NotificationPrefs>;
  saveProfile(profile: Api.ProfileRequest): Promise<Api.Account>;
  setActive(active: boolean): Promise<Api.ActiveRequest>;
  questionnaire(): Promise<Api.Questionnaire>;
  answers(): Promise<Api.AnswersBody>;
  saveAnswers(answers: Api.AnswersBody['answers']): Promise<void>;
  desires(): Promise<Api.DesiresBody>;
  saveDesires(desires: Api.DesiresBody['desires']): Promise<void>;
  home(): Promise<Api.Home>;
  sayHello(matchId: string): Promise<Api.HelloResponse>;
  pass(matchId: string): Promise<void>;
  /** The conversation, or with `after`, only the messages newer than that one. */
  messages(matchId: string, after?: string): Promise<Api.MessagesResponse>;
  sendMessage(matchId: string, body: string): Promise<Api.SendMessageResponse>;
  /** Tell the other person this one is writing (they see it for a few seconds). */
  typing(matchId: string): Promise<void>;
  /** Every match from published rounds, newest first. */
  matches(): Promise<Api.MatchesResponse>;
  /** Report a match; this also ends it. */
  report(matchId: string, report: Api.ReportRequest): Promise<void>;
  /** One match from any round, with the other person's profile. */
  match(matchId: string): Promise<Api.MatchDetail>;
  /** Add a photo from a local file (a JPEG, as the picker step leaves it). Returns every photo. */
  uploadPhoto(uri: string): Promise<Api.PhotosResponse>;
  deletePhoto(photoId: string): Promise<Api.PhotosResponse>;
  /** Every photo id, main first. */
  reorderPhotos(ids: string[]): Promise<Api.PhotosResponse>;
  saveWords(words: Api.WordsRequest): Promise<Api.WordsResponse>;
  prompts(): Promise<Api.PromptsResponse>;
  /** Where to load a photo from. The API decides whether this person may see that version. */
  photoSource(photoId: string, variant: Api.PhotoVariant): PhotoSource;
}

export interface ClientOptions {
  baseUrl: string;
  token: () => string | null;
  /** Called on any 401 from an authenticated call: the session is gone. */
  onUnauthorized: () => void;
}

export function createApiClient(options: ClientOptions): ApiClient {
  async function call<T>(method: string, path: string, body?: unknown): Promise<T> {
    const token = options.token();
    // A form (a photo upload) sets its own multipart Content-Type.
    const form = body instanceof FormData;
    let response: Response;
    try {
      response = await fetch(`${options.baseUrl}${path}`, {
        method,
        headers: {
          Accept: 'application/json',
          ...(body === undefined || form ? {} : { 'Content-Type': 'application/json' }),
          ...(token === null ? {} : { Authorization: `Bearer ${token}` }),
        },
        ...(body === undefined ? {} : { body: form ? body : JSON.stringify(body) }),
      });
    } catch {
      throw new ApiError(0, 'network', null);
    }

    if (response.status === 204) return undefined as T;
    const json = (await response.json().catch(() => null)) as unknown;
    if (!response.ok) {
      const error = (json ?? null) as Api.ApiError | null;
      if (response.status === 401 && token !== null) options.onUnauthorized();
      throw new ApiError(response.status, error?.error ?? 'unknown', error);
    }
    return json as T;
  }

  return {
    sendCode: (email) => call('POST', '/auth/code', { email } satisfies Api.SendCodeRequest),
    verifyCode: (verificationId, code) =>
      call('POST', '/auth/verify', { verificationId, code } satisfies Api.VerifyCodeRequest),
    signOut: (request = {}) => call('POST', '/auth/sign-out', request),
    registerPushToken: (token, platform) =>
      call('PUT', '/me/push-token', { token, platform } satisfies Api.PushTokenRequest),
    me: () => call('GET', '/me'),
    deleteAccount: () => call('DELETE', '/me'),
    exportData: () => call('GET', '/me/export'),
    setNotifications: (changes) => call('PUT', '/me/notifications', changes),
    saveProfile: (profile) => call('PUT', '/me/profile', profile),
    setActive: (active) => call('PUT', '/me/active', { active } satisfies Api.ActiveRequest),
    questionnaire: () => call('GET', '/questionnaire'),
    answers: () => call('GET', '/me/answers'),
    saveAnswers: (answers) => call('PUT', '/me/answers', { answers } satisfies Api.AnswersBody),
    desires: () => call('GET', '/me/desires'),
    saveDesires: (desires) => call('PUT', '/me/desires', { desires } satisfies Api.DesiresBody),
    home: () => call('GET', '/home'),
    sayHello: (matchId) => call('POST', `/matches/${encodeURIComponent(matchId)}/hello`),
    pass: (matchId) => call('POST', `/matches/${encodeURIComponent(matchId)}/pass`),
    messages: (matchId, after) =>
      call(
        'GET',
        `/matches/${encodeURIComponent(matchId)}/messages${after === undefined ? '' : `?after=${encodeURIComponent(after)}`}`,
      ),
    sendMessage: (matchId, body) =>
      call('POST', `/matches/${encodeURIComponent(matchId)}/messages`, { body } satisfies Api.SendMessageRequest),
    typing: (matchId) => call('POST', `/matches/${encodeURIComponent(matchId)}/typing`),
    matches: () => call('GET', '/matches'),
    report: (matchId, report) => call('POST', `/matches/${encodeURIComponent(matchId)}/report`, report),
    match: (matchId) => call('GET', `/matches/${encodeURIComponent(matchId)}`),
    uploadPhoto: async (uri) => {
      const form = new FormData();
      if (Platform.OS === 'web') {
        form.append('photo', await (await fetch(uri)).blob(), 'photo.jpg');
      } else {
        // React Native's FormData sends a local file given as { uri, name, type }.
        form.append('photo', { uri, name: 'photo.jpg', type: 'image/jpeg' } as unknown as Blob);
      }
      return call('POST', '/me/photos', form);
    },
    deletePhoto: (photoId) => call('DELETE', `/me/photos/${encodeURIComponent(photoId)}`),
    reorderPhotos: (ids) => call('PUT', '/me/photos/order', { ids } satisfies Api.PhotoOrderRequest),
    saveWords: (words) => call('PUT', '/me/words', words),
    prompts: () => call('GET', '/prompts'),
    photoSource: (photoId, variant) => {
      const token = options.token();
      const headers: Record<string, string> = token === null ? {} : { Authorization: `Bearer ${token}` };
      return { uri: `${options.baseUrl}/photos/${encodeURIComponent(photoId)}/${variant}`, headers, cacheKey: `${photoId}-${variant}` };
    },
  };
}

/** Words for an error the person can act on. */
export function describeError(error: unknown): string {
  if (!(error instanceof ApiError)) return 'Something went wrong. Please try again.';
  switch (error.code) {
    case 'network':
      return "Can't reach HateD right now. Check your connection and try again.";
    case 'rate-limited':
      return `Please wait ${error.body?.retryAfterSeconds ?? 60} seconds before asking for another code.`;
    case 'delivery-failed':
      return "We couldn't send the email just now. Please try again in a minute.";
    case 'invalid':
      return error.body?.problems?.join(' ') ?? 'Please check your answers.';
    case 'not-mutual':
      return 'The conversation opens once you have both said hello.';
    case 'passed':
      return 'This conversation has ended.';
    case 'expired':
      return 'The time to say hello is up.';
    case 'too-many':
    case 'too-large':
      return error.body?.problems?.join(' ') ?? 'That photo could not be added.';
    default:
      return 'Something went wrong. Please try again.';
  }
}
