-- AlterTable
ALTER TABLE "users" ADD COLUMN     "notifyHellos" BOOLEAN NOT NULL DEFAULT true,
ADD COLUMN     "notifyMessages" BOOLEAN NOT NULL DEFAULT true,
ADD COLUMN     "notifyRounds" BOOLEAN NOT NULL DEFAULT true;

