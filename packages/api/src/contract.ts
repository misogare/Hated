/**
 * The HTTP contract between the API and the app: request and response bodies.
 *
 * Self-contained on purpose (no imports), so the mobile app can import these
 * types straight from source with `import type`, with no build step and no
 * server code pulled into the bundle. The API asserts at compile time that what
 * it sends matches these shapes.
 *
 * Dates travel as ISO 8601 strings; birthdays as `YYYY-MM-DD`.
 */

/** Every non-2xx response. `error` is a stable machine-readable code. */
export interface ApiError {
  error: string;
  /** Human-readable problems, for `invalid` input. */
  problems?: string[];
  /** Wrong-code guesses left, for `invalid-code`. */
  attemptsRemaining?: number;
  /** When a rate-limited request may be retried. */
  retryAfterSeconds?: number;
}

// --- Sign-in ---------------------------------------------------------------

export interface SendCodeRequest {
  email: string;
}

export interface SendCodeResponse {
  verificationId: string;
  /** The normalised address the code went to. */
  email: string;
  expiresAt: string;
}

export interface VerifyCodeRequest {
  verificationId: string;
  code: string;
}

/** `POST /auth/sign-out`: this device, or with `everywhere`, every device. */
export interface SignOutRequest {
  everywhere?: boolean;
  /** This device's push token, so it stops receiving notifications. */
  pushToken?: string;
}

/** `PUT /me/push-token`: this device can receive push notifications. */
export interface PushTokenRequest {
  /** An Expo push token, `ExponentPushToken[...]`. */
  token: string;
  platform: 'ios' | 'android';
}

export interface SessionResponse {
  /** Send as `Authorization: Bearer <token>`. */
  token: string;
  expiresAt: string;
}

// --- Account and profile ---------------------------------------------------

export interface Account {
  userId: string;
  email: string;
  emailVerified: boolean;
  institution: { name: string; domain: string } | null;
  profile: {
    displayName: string;
    birthDate: string;
    age: number;
    gender: string;
    seeking: string[];
    isActive: boolean;
    /** Their line in their own words. */
    bio: string | null;
    prompts: PromptAnswer[];
    /** What a match reads about them, worked out from their questionnaire. */
    highlights: string[];
  } | null;
  /** Main first. */
  photos: Photo[];
  /** `photos`: at least two photos, the last onboarding step. */
  onboarding: { profile: boolean; answers: boolean; photos: boolean };
  /** Which push notifications they want. */
  notifications: NotificationPrefs;
}

/** Each kind of push notification, on or off (for every device). */
export interface NotificationPrefs {
  /** A new message in a conversation. */
  messages: boolean;
  /** The other person said hello back, so the conversation is open. */
  hellos: boolean;
  /** A round's result is in. */
  rounds: boolean;
}

/** Kinds left out stay as they are. */
export type NotificationsRequest = Partial<NotificationPrefs>;

/**
 * Everything HateD holds about the person, as one document (`GET /me/export`).
 * The app saves it as it is; its sections are described in packages/db's README.
 */
export interface DataExport {
  format: 'hated-export';
  version: number;
  exportedAt: string;
  about: string;
}

// --- Photos and words ------------------------------------------------------

/**
 * A profile photo. Fetch it from `GET /photos/:id/full` or
 * `GET /photos/:id/blurred`, with the session token: a match gets only the
 * blurred one until both have said hello.
 */
export interface Photo {
  id: string;
  /** Of the full photo, so a layout can keep its shape before it loads. */
  width: number;
  height: number;
}

export type PhotoVariant = 'full' | 'blurred';

/** The person's photos after a change, main first. */
export interface PhotosResponse {
  photos: Photo[];
}

/** `PUT /me/photos/order`: every one of the person's photo ids, main first. */
export interface PhotoOrderRequest {
  ids: string[];
}

/** A prompt the app offers, e.g. `{ key: 'perfect-sunday', label: 'A perfect Sunday' }`. */
export interface Prompt {
  key: string;
  label: string;
}

export interface PromptsResponse {
  prompts: Prompt[];
}

export interface PromptAnswer extends Prompt {
  answer: string;
}

/** `PUT /me/words`. Up to three prompts; a blank answer drops that prompt. */
export interface WordsRequest {
  bio: string | null;
  prompts: Array<{ key: string; answer: string }>;
}

export interface WordsResponse {
  bio: string | null;
  prompts: PromptAnswer[];
}

export interface ProfileRequest {
  displayName: string;
  /** `YYYY-MM-DD`. */
  birthDate: string;
  gender: string;
  /** Empty means open to everyone. */
  seeking: string[];
}

export interface ActiveRequest {
  active: boolean;
}

// --- Questionnaire ---------------------------------------------------------

export type QuestionKind = 'SINGLE_CHOICE' | 'MULTI_CHOICE' | 'SCALE' | 'BOOLEAN' | 'TEXT';

export interface Question {
  key: string;
  prompt: string;
  kind: QuestionKind;
  traitKey: string | null;
  /** SCALE: `{ min, max, left?, right? }`; SINGLE_CHOICE: `{ choices }`. */
  options: unknown;
}

export interface Questionnaire {
  id: string;
  title: string;
  questions: Question[];
}

/** A SCALE answer in [0, 1], a SINGLE_CHOICE choice, or null to skip. */
export type AnswerValue = number | string | null;

export interface AnswersBody {
  answers: Record<string, AnswerValue>;
}

export interface Desire {
  /** The value hoped for, in [0, 1]. */
  target: number;
  /** How much it matters, in [0, 1]; 0 means "don't mind". */
  weight: number;
}

export interface DesiresBody {
  desires: Record<string, Desire>;
}

// --- Rounds ----------------------------------------------------------------

export interface Match {
  matchId: string;
  partner: {
    displayName: string;
    age: number;
    institution: string | null;
    bio: string | null;
    prompts: PromptAnswer[];
    /** Worked out from their questionnaire, e.g. "Humor comes first". */
    highlights: string[];
    /** Main first. None once the match has ended. */
    photos: Photo[];
  };
  /** Both said hello and neither passed: the photos can be fetched in full. */
  photosUnlocked: boolean;
  reasons: string[];
  /** Ways to start the conversation, from the partner's prompts and what the two share. */
  openers: string[];
  saidHello: boolean;
  mutual: boolean;
  passed: boolean;
  /** Messages from the partner not yet read. */
  unread: number;
}

/** One entry in `GET /matches`: every match from published rounds, newest first. */
export interface MatchSummary {
  matchId: string;
  roundId: string;
  publishedAt: string;
  partner: {
    displayName: string;
    age: number;
    institution: string | null;
    /** Their main photo; none once the match has ended. */
    photo: Photo | null;
  };
  saidHello: boolean;
  mutual: boolean;
  passed: boolean;
  /** Both said hello and neither passed: the photo can be fetched in full. */
  photosUnlocked: boolean;
  lastMessage: { body: string; sentAt: string; mine: boolean } | null;
  unread: number;
}

/** `GET /matches/:id`: one match, from any published round. */
export interface MatchDetail {
  roundId: string;
  publishedAt: string;
  match: Match;
}

export interface MatchesResponse {
  matches: MatchSummary[];
}

export type ReportReason = 'harassment' | 'inappropriate' | 'spam' | 'unsafe' | 'other';

/** `POST /matches/:id/report`. Reporting also ends the match. */
export interface ReportRequest {
  reason: ReportReason;
  details?: string;
}

export type RoundResult =
  | { status: 'none' }
  | { status: 'matched'; roundId: string; publishedAt: string; match: Match }
  | { status: 'unmatched'; roundId: string; publishedAt: string; reason: string | null };

export interface Home {
  /** When the next round closes. */
  nextRoundAt: string;
  /** Whether this person is in the next round; false before they have a profile. */
  isActive: boolean;
  /** The latest published round they were in. */
  result: RoundResult;
  /** Unread messages across all their matches. */
  unreadTotal: number;
}

export interface HelloResponse {
  mutual: boolean;
}

// --- Chat ------------------------------------------------------------------

export interface ChatMessage {
  id: string;
  body: string;
  sentAt: string;
  /** Sent by the person reading. */
  mine: boolean;
}

/** `GET /matches/:id/messages[?after=<message id>]`, oldest first. */
export interface MessagesResponse {
  messages: ChatMessage[];
}

export interface SendMessageRequest {
  body: string;
}

export interface SendMessageResponse {
  message: ChatMessage;
}

// --- Live updates ------------------------------------------------------------

/**
 * What arrives over the WebSocket at `/live` once signed in (send
 * `{ type: 'auth', token }` first; the answer is `{ type: 'ready' }`). Each
 * says only what changed for this person, so the app can fetch it.
 */
export type LiveEvent =
  | { type: 'mutual'; matchId: string }
  | { type: 'message'; matchId: string }
  | { type: 'ended'; matchId: string }
  | { type: 'round'; roundId: string };
