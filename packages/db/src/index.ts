/**
 * Shared Postgres access for HateD.
 *
 * The Prisma client is generated into `src/generated/prisma` (see the generator
 * block in prisma/schema.prisma). Prisma ORM v7 requires a driver adapter, so
 * every client is constructed with `@prisma/adapter-pg` here rather than with a
 * bare `new PrismaClient()`.
 */

import { PrismaPg } from '@prisma/adapter-pg';

import { PrismaClient } from './generated/prisma/client.js';

export * from './generated/prisma/client.js';

export {
  PROFILE_INCLUDE,
  toEngineProfile,
  toEngineProfiles,
  type ProfileRow,
  type ProfileWithRelations,
} from './mapper.js';

export {
  loadEngineProfiles,
  type LoadPopulationOptions,
} from './population.js';

export {
  persistMatchRound,
  type PersistMatchRoundOptions,
  type PersistedMatchRound,
} from './rounds.js';

export {
  runScheduledRound,
  type ScheduledRoundOptions,
  type ScheduledRoundResult,
} from './scheduled-rounds.js';

export {
  getRoundReport,
  listRecentRounds,
  type RoundReport,
  type RoundReportMatch,
  type RoundReportParticipant,
  type RoundSummary,
  type StoredMetrics,
} from './round-info.js';

export {
  SESSION_TTL_MS,
  createSession,
  resolveSession,
  revokeAllSessions,
  revokeSession,
  type NewSession,
} from './sessions.js';

export {
  startSignIn,
  type StartSignInOptions,
  type StartSignInResult,
} from './sign-in.js';

export {
  MIN_AGE,
  ageOn,
  getAccount,
  saveProfile,
  setProfileActive,
  validateProfileInput,
  type AccountView,
  type ProfileInput,
  type SaveProfileResult,
} from './profiles.js';

export {
  getActiveQuestionnaire,
  getAnswers,
  getDesires,
  saveAnswers,
  saveDesires,
  type AnswerValue,
  type DesireInput,
  type QuestionView,
  type QuestionnaireView,
  type SaveResult,
} from './answers.js';

export {
  explainMatch,
  getLatestResult,
  getMatch,
  passMatch,
  sayHello,
  type MatchActionResult,
  type MatchDetail,
  type MatchView,
  type RoundResultView,
  type TraitSnapshot,
} from './results.js';

export {
  pushTokensFor,
  registerPushToken,
  removePushTokens,
  unregisterAllPushTokens,
  unregisterPushToken,
  type PushPlatform,
  type RegisterPushTokenResult,
} from './push-tokens.js';

export {
  createExpoPushSender,
  type ExpoPushSenderOptions,
  type PushMessage,
  type PushSender,
  type PushTicket,
} from './push-sender.js';

export { createNotifier, describeWindow, silentNotifier, type Notifier } from './notify.js';

export {
  LIVE_CHANNEL,
  combineNotifiers,
  createLiveNotifier,
  listenLive,
  publishLive,
  type LiveEvent,
  type LiveListener,
} from './live.js';

export { deleteAccount } from './accounts.js';

export { HELLO_WINDOW_MS, helloDeadline, helloExpired, reminderLeadMs, type HelloWindowOptions } from './hello-window.js';

export { sendHelloReminders } from './hello-reminders.js';

export { listReports, resolveReport, type ReportView } from './reports.js';

export {
  FEEDBACK_ANSWERS,
  feedbackDue,
  giveFeedback,
  type FeedbackAnswer,
  type FeedbackDue,
  type FeedbackResult,
} from './feedback.js';

export { createDiskPhotoStore, createMemoryPhotoStore, defaultPhotoDir, type PhotoStore } from './photo-store.js';

export { MAX_UPLOAD_BYTES, MIN_PHOTO_SIDE, processPhoto, type ProcessPhotoResult, type ProcessedPhoto } from './photo-processing.js';

export {
  MAX_PHOTOS,
  MIN_PHOTOS,
  addPhoto,
  deletePhoto,
  listPhotos,
  listPhotosToReview,
  photoAccess,
  photoKey,
  readPhoto,
  readPhotoForReview,
  removePhotoFiles,
  reorderPhotos,
  reviewPhoto,
  type AddPhotoResult,
  type OwnPhotoView,
  type PhotoReview,
  type PhotoToReview,
  type PhotoVariant,
  type PhotoView,
  type ReorderPhotosResult,
} from './photos.js';

export {
  MAX_BIO_LENGTH,
  MAX_PROMPTS,
  MAX_PROMPT_ANSWER_LENGTH,
  PROMPTS,
  saveWords,
  validateWords,
  type PromptAnswer,
  type SaveWordsResult,
  type WordsInput,
  type WordsView,
} from './profile-words.js';

export { describePerson, suggestOpeners } from './descriptions.js';

export { profileCard, type ProfileCard } from './profile-card.js';

export { EXPORT_VERSION, exportAccount, type AccountExport } from './data-export.js';

export {
  NOTIFICATION_KINDS,
  getNotificationPrefs,
  setNotificationPrefs,
  type NotificationKind,
  type NotificationPrefs,
} from './notification-prefs.js';

export {
  REPORT_REASONS,
  listMatches,
  reportMatch,
  type MatchSummary,
  type ReportReason,
  type ReportResult,
} from './matches.js';

export {
  MAX_MESSAGE_LENGTH,
  announceTyping,
  listMessages,
  sendMessage,
  type ChatClosedReason,
  type ListMessagesResult,
  type MessageView,
  type SendMessageResult,
  type TypingResult,
} from './chat.js';

export {
  findInstitutionForEmail,
  normalizeEmail,
  requestVerificationCode,
  startVerification,
  verifyCode,
  type IssuedVerification,
  type RequestVerificationCodeInput,
  type RequestVerificationCodeOptions,
  type RequestVerificationCodeResult,
  type StartVerificationInput,
  type StartVerificationResult,
  type VerificationServiceOptions,
  type VerifyCodeInput,
  type VerifyCodeResult,
  type VerifyFailureReason,
} from './verification.js';

export {
  createConsoleMailer,
  createResendMailer,
  renderVerificationEmail,
  type ConsoleMailerOptions,
  type EmailMessage,
  type MailFetch,
  type MailFetchResponse,
  type Mailer,
  type ResendMailerOptions,
  type VerificationEmailInput,
} from './mailer.js';

export {
  createSmtpMailer,
  smtpTransportOptions,
  type SmtpMailer,
  type SmtpMailerOptions,
  type SmtpTransport,
} from './smtp-mailer.js';

export {
  MAIL_TRANSPORTS,
  createMailer,
  describeMailConfig,
  explainMailError,
  isMailTransportKind,
  resolveMailConfig,
  type ConfiguredMailer,
  type MailConfig,
  type MailEnv,
  type MailTransportKind,
  type ResolveMailConfigOptions,
} from './mail-config.js';

export interface CreatePrismaClientOptions {
  /** Overrides `process.env.DATABASE_URL`. */
  connectionString?: string;
}

/**
 * Build a Prisma client bound to a Postgres connection.
 *
 * Long-running apps should call this once and reuse the instance; creating many
 * instances creates many connection pools.
 */
export function createPrismaClient(options: CreatePrismaClientOptions = {}): PrismaClient {
  const connectionString = options.connectionString ?? process.env.DATABASE_URL;
  if (!connectionString) {
    throw new Error(
      'DATABASE_URL is not set. Copy packages/db/.env.example to .env or pass a connection string.',
    );
  }

  const adapter = new PrismaPg({ connectionString });
  return new PrismaClient({ adapter });
}
