-- CreateEnum
CREATE TYPE "DonorStatus" AS ENUM ('NEVER_DONATED', 'PENDING_REVIEW', 'ACTIVE', 'DEFERRED', 'INELIGIBLE');

-- AlterTable
ALTER TABLE "User"
  ADD COLUMN "donorStatus"          "DonorStatus" NOT NULL DEFAULT 'NEVER_DONATED',
  ADD COLUMN "deferralDate"         TIMESTAMP(3),
  ADD COLUMN "deferralReason"       TEXT,
  ADD COLUMN "nextEligibleDate"     TIMESTAMP(3),
  ADD COLUMN "eligibilityCheckedAt" TIMESTAMP(3),
  ADD COLUMN "reminderSet"          BOOLEAN NOT NULL DEFAULT false;

-- Backfill: active eligible donors → ACTIVE
UPDATE "User" SET "donorStatus" = 'ACTIVE'
WHERE "isDonor" = true AND "isDonorEligible" = true;
