-- CreateEnum
CREATE TYPE "PhotoStatus" AS ENUM ('PENDING', 'APPROVED', 'REJECTED');

-- AlterTable
ALTER TABLE "photos" ADD COLUMN     "reviewedAt" TIMESTAMP(3),
ADD COLUMN     "status" "PhotoStatus" NOT NULL DEFAULT 'PENDING';

-- CreateIndex
CREATE INDEX "photos_status_idx" ON "photos"("status");


-- Photos from before reviews existed were already shown to matches: they stay approved.
UPDATE "photos" SET "status" = 'APPROVED', "reviewedAt" = "createdAt";
