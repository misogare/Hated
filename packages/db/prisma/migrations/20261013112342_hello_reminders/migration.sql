-- AlterTable
ALTER TABLE "users" ADD COLUMN     "notifyReminders" BOOLEAN NOT NULL DEFAULT true;

-- CreateTable
CREATE TABLE "hello_reminders" (
    "matchId" TEXT NOT NULL,
    "profileId" TEXT NOT NULL,
    "sentAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "hello_reminders_pkey" PRIMARY KEY ("matchId","profileId")
);

-- CreateIndex
CREATE INDEX "hello_reminders_profileId_idx" ON "hello_reminders"("profileId");

-- AddForeignKey
ALTER TABLE "hello_reminders" ADD CONSTRAINT "hello_reminders_matchId_fkey" FOREIGN KEY ("matchId") REFERENCES "matches"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "hello_reminders" ADD CONSTRAINT "hello_reminders_profileId_fkey" FOREIGN KEY ("profileId") REFERENCES "profiles"("id") ON DELETE CASCADE ON UPDATE CASCADE;

