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

export interface ApiClient {
  sendCode(email: string): Promise<Api.SendCodeResponse>;
  verifyCode(verificationId: string, code: string): Promise<Api.SessionResponse>;
  /** End this device's session on the server, or with `everywhere`, every session. */
  signOut(everywhere?: boolean): Promise<void>;
  me(): Promise<Api.Account>;
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
  /** Every match from published rounds, newest first. */
  matches(): Promise<Api.MatchesResponse>;
  /** Report a match; this also ends it. */
  report(matchId: string, report: Api.ReportRequest): Promise<void>;
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
    let response: Response;
    try {
      response = await fetch(`${options.baseUrl}${path}`, {
        method,
        headers: {
          Accept: 'application/json',
          ...(body === undefined ? {} : { 'Content-Type': 'application/json' }),
          ...(token === null ? {} : { Authorization: `Bearer ${token}` }),
        },
        ...(body === undefined ? {} : { body: JSON.stringify(body) }),
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
    signOut: (everywhere = false) =>
      call('POST', '/auth/sign-out', everywhere ? ({ everywhere: true } satisfies Api.SignOutRequest) : undefined),
    me: () => call('GET', '/me'),
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
    matches: () => call('GET', '/matches'),
    report: (matchId, report) => call('POST', `/matches/${encodeURIComponent(matchId)}/report`, report),
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
    default:
      return 'Something went wrong. Please try again.';
  }
}
