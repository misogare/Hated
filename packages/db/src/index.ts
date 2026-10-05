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
  getRoundReport,
  type RoundReport,
  type RoundReportMatch,
  type RoundReportParticipant,
  type StoredMetrics,
} from './round-info.js';

export {
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
