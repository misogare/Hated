-- CreateSchema
CREATE SCHEMA IF NOT EXISTS "public";

-- CreateEnum
CREATE TYPE "VerificationType" AS ENUM ('EDU', 'GOV');

-- CreateEnum
CREATE TYPE "VerificationStatus" AS ENUM ('PENDING', 'VERIFIED', 'EXPIRED', 'REVOKED');

-- CreateEnum
CREATE TYPE "QuestionKind" AS ENUM ('SINGLE_CHOICE', 'MULTI_CHOICE', 'SCALE', 'BOOLEAN', 'TEXT');

-- CreateEnum
CREATE TYPE "Side" AS ENUM ('A', 'B');

-- CreateEnum
CREATE TYPE "MatchRoundStatus" AS ENUM ('DRAFT', 'COMPUTED', 'PUBLISHED', 'CANCELLED');

-- CreateTable
CREATE TABLE "users" (
    "id" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "emailVerified" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "users_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "profiles" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "displayName" TEXT NOT NULL,
    "birthDate" TIMESTAMP(3) NOT NULL,
    "genderId" TEXT NOT NULL,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "similarityWeight" DOUBLE PRECISION,
    "desireWeight" DOUBLE PRECISION,
    "reciprocityWeight" DOUBLE PRECISION,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "profiles_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "profile_seeking" (
    "profileId" TEXT NOT NULL,
    "genderId" TEXT NOT NULL,

    CONSTRAINT "profile_seeking_pkey" PRIMARY KEY ("profileId","genderId")
);

-- CreateTable
CREATE TABLE "profile_traits" (
    "id" TEXT NOT NULL,
    "profileId" TEXT NOT NULL,
    "key" TEXT NOT NULL,
    "value" DOUBLE PRECISION NOT NULL,

    CONSTRAINT "profile_traits_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "profile_desires" (
    "id" TEXT NOT NULL,
    "profileId" TEXT NOT NULL,
    "key" TEXT NOT NULL,
    "target" DOUBLE PRECISION NOT NULL,
    "weight" DOUBLE PRECISION NOT NULL,

    CONSTRAINT "profile_desires_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "profile_blocks" (
    "blockerId" TEXT NOT NULL,
    "blockedId" TEXT NOT NULL,
    "reason" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "profile_blocks_pkey" PRIMARY KEY ("blockerId","blockedId")
);

-- CreateTable
CREATE TABLE "questionnaires" (
    "id" TEXT NOT NULL,
    "key" TEXT NOT NULL,
    "version" INTEGER NOT NULL,
    "title" TEXT NOT NULL,
    "description" TEXT,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "questionnaires_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "questions" (
    "id" TEXT NOT NULL,
    "questionnaireId" TEXT NOT NULL,
    "key" TEXT NOT NULL,
    "prompt" TEXT NOT NULL,
    "kind" "QuestionKind" NOT NULL,
    "position" INTEGER NOT NULL,
    "traitKey" TEXT,
    "options" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "questions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "questionnaire_responses" (
    "id" TEXT NOT NULL,
    "profileId" TEXT NOT NULL,
    "questionnaireId" TEXT NOT NULL,
    "submittedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "derivedAt" TIMESTAMP(3),

    CONSTRAINT "questionnaire_responses_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "answers" (
    "id" TEXT NOT NULL,
    "responseId" TEXT NOT NULL,
    "questionId" TEXT NOT NULL,
    "valueNumber" DOUBLE PRECISION,
    "valueText" TEXT,
    "valueJson" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "answers_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "match_rounds" (
    "id" TEXT NOT NULL,
    "status" "MatchRoundStatus" NOT NULL DEFAULT 'DRAFT',
    "objective" TEXT NOT NULL,
    "config" JSONB NOT NULL,
    "seed" INTEGER,
    "population" INTEGER NOT NULL,
    "matched" INTEGER NOT NULL,
    "matchRate" DOUBLE PRECISION NOT NULL,
    "stable" BOOLEAN NOT NULL,
    "metrics" JSONB,
    "startedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "completedAt" TIMESTAMP(3),

    CONSTRAINT "match_rounds_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "match_round_participants" (
    "id" TEXT NOT NULL,
    "roundId" TEXT NOT NULL,
    "profileId" TEXT NOT NULL,
    "side" "Side" NOT NULL,
    "matched" BOOLEAN NOT NULL DEFAULT false,
    "unmatchedReason" TEXT,

    CONSTRAINT "match_round_participants_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "matches" (
    "id" TEXT NOT NULL,
    "roundId" TEXT NOT NULL,
    "profileAId" TEXT NOT NULL,
    "profileBId" TEXT NOT NULL,
    "scoreAB" DOUBLE PRECISION,
    "scoreBA" DOUBLE PRECISION,
    "rankA" INTEGER,
    "rankB" INTEGER,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "matches_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "institutions" (
    "id" TEXT NOT NULL,
    "domain" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "type" "VerificationType" NOT NULL,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "institutions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "institution_verifications" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "domain" TEXT NOT NULL,
    "type" "VerificationType" NOT NULL,
    "status" "VerificationStatus" NOT NULL DEFAULT 'PENDING',
    "codeHash" TEXT NOT NULL,
    "codeSalt" TEXT,
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "consumedAt" TIMESTAMP(3),
    "verifiedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "institutionId" TEXT,

    CONSTRAINT "institution_verifications_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "users_email_key" ON "users"("email");

-- CreateIndex
CREATE UNIQUE INDEX "profiles_userId_key" ON "profiles"("userId");

-- CreateIndex
CREATE INDEX "profiles_genderId_idx" ON "profiles"("genderId");

-- CreateIndex
CREATE INDEX "profiles_isActive_idx" ON "profiles"("isActive");

-- CreateIndex
CREATE UNIQUE INDEX "profile_traits_profileId_key_key" ON "profile_traits"("profileId", "key");

-- CreateIndex
CREATE UNIQUE INDEX "profile_desires_profileId_key_key" ON "profile_desires"("profileId", "key");

-- CreateIndex
CREATE INDEX "profile_blocks_blockedId_idx" ON "profile_blocks"("blockedId");

-- CreateIndex
CREATE UNIQUE INDEX "questionnaires_key_version_key" ON "questionnaires"("key", "version");

-- CreateIndex
CREATE INDEX "questions_questionnaireId_position_idx" ON "questions"("questionnaireId", "position");

-- CreateIndex
CREATE UNIQUE INDEX "questions_questionnaireId_key_key" ON "questions"("questionnaireId", "key");

-- CreateIndex
CREATE UNIQUE INDEX "questionnaire_responses_profileId_questionnaireId_key" ON "questionnaire_responses"("profileId", "questionnaireId");

-- CreateIndex
CREATE UNIQUE INDEX "answers_responseId_questionId_key" ON "answers"("responseId", "questionId");

-- CreateIndex
CREATE INDEX "match_rounds_status_idx" ON "match_rounds"("status");

-- CreateIndex
CREATE INDEX "match_round_participants_roundId_matched_idx" ON "match_round_participants"("roundId", "matched");

-- CreateIndex
CREATE UNIQUE INDEX "match_round_participants_roundId_profileId_key" ON "match_round_participants"("roundId", "profileId");

-- CreateIndex
CREATE UNIQUE INDEX "matches_roundId_profileAId_key" ON "matches"("roundId", "profileAId");

-- CreateIndex
CREATE UNIQUE INDEX "matches_roundId_profileBId_key" ON "matches"("roundId", "profileBId");

-- CreateIndex
CREATE UNIQUE INDEX "matches_roundId_profileAId_profileBId_key" ON "matches"("roundId", "profileAId", "profileBId");

-- CreateIndex
CREATE UNIQUE INDEX "institutions_domain_key" ON "institutions"("domain");

-- CreateIndex
CREATE INDEX "institution_verifications_email_status_idx" ON "institution_verifications"("email", "status");

-- CreateIndex
CREATE INDEX "institution_verifications_expiresAt_idx" ON "institution_verifications"("expiresAt");

-- AddForeignKey
ALTER TABLE "profiles" ADD CONSTRAINT "profiles_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "profile_seeking" ADD CONSTRAINT "profile_seeking_profileId_fkey" FOREIGN KEY ("profileId") REFERENCES "profiles"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "profile_traits" ADD CONSTRAINT "profile_traits_profileId_fkey" FOREIGN KEY ("profileId") REFERENCES "profiles"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "profile_desires" ADD CONSTRAINT "profile_desires_profileId_fkey" FOREIGN KEY ("profileId") REFERENCES "profiles"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "profile_blocks" ADD CONSTRAINT "profile_blocks_blockerId_fkey" FOREIGN KEY ("blockerId") REFERENCES "profiles"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "profile_blocks" ADD CONSTRAINT "profile_blocks_blockedId_fkey" FOREIGN KEY ("blockedId") REFERENCES "profiles"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "questions" ADD CONSTRAINT "questions_questionnaireId_fkey" FOREIGN KEY ("questionnaireId") REFERENCES "questionnaires"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "questionnaire_responses" ADD CONSTRAINT "questionnaire_responses_profileId_fkey" FOREIGN KEY ("profileId") REFERENCES "profiles"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "questionnaire_responses" ADD CONSTRAINT "questionnaire_responses_questionnaireId_fkey" FOREIGN KEY ("questionnaireId") REFERENCES "questionnaires"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "answers" ADD CONSTRAINT "answers_responseId_fkey" FOREIGN KEY ("responseId") REFERENCES "questionnaire_responses"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "answers" ADD CONSTRAINT "answers_questionId_fkey" FOREIGN KEY ("questionId") REFERENCES "questions"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "match_round_participants" ADD CONSTRAINT "match_round_participants_roundId_fkey" FOREIGN KEY ("roundId") REFERENCES "match_rounds"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "match_round_participants" ADD CONSTRAINT "match_round_participants_profileId_fkey" FOREIGN KEY ("profileId") REFERENCES "profiles"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "matches" ADD CONSTRAINT "matches_roundId_fkey" FOREIGN KEY ("roundId") REFERENCES "match_rounds"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "matches" ADD CONSTRAINT "matches_profileAId_fkey" FOREIGN KEY ("profileAId") REFERENCES "profiles"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "matches" ADD CONSTRAINT "matches_profileBId_fkey" FOREIGN KEY ("profileBId") REFERENCES "profiles"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "institution_verifications" ADD CONSTRAINT "institution_verifications_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "institution_verifications" ADD CONSTRAINT "institution_verifications_institutionId_fkey" FOREIGN KEY ("institutionId") REFERENCES "institutions"("id") ON DELETE SET NULL ON UPDATE CASCADE;
