-- CreateTable
CREATE TABLE "match_feedback" (
    "matchId" TEXT NOT NULL,
    "profileId" TEXT NOT NULL,
    "answer" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "match_feedback_pkey" PRIMARY KEY ("matchId","profileId")
);

-- CreateIndex
CREATE INDEX "match_feedback_profileId_idx" ON "match_feedback"("profileId");

-- AddForeignKey
ALTER TABLE "match_feedback" ADD CONSTRAINT "match_feedback_matchId_fkey" FOREIGN KEY ("matchId") REFERENCES "matches"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "match_feedback" ADD CONSTRAINT "match_feedback_profileId_fkey" FOREIGN KEY ("profileId") REFERENCES "profiles"("id") ON DELETE CASCADE ON UPDATE CASCADE;

