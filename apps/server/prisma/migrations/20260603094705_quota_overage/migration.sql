-- AlterTable
ALTER TABLE "users" ADD COLUMN "quotaExceededSince" DATETIME;
ALTER TABLE "users" ADD COLUMN "quotaLastWarnedThreshold" INTEGER;
