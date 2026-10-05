-- AlterTable
ALTER TABLE "match_rounds" ADD COLUMN     "scheduledFor" TIMESTAMP(3);

-- CreateIndex
CREATE UNIQUE INDEX "match_rounds_scheduledFor_key" ON "match_rounds"("scheduledFor");

