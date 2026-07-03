-- Phase 4: extend RequestStatus enum and add request fields
--
-- PostgreSQL note: ALTER TYPE ... ADD VALUE cannot be used in the same
-- transaction as a statement that references the new value (PG error 55P04).
-- The new enum values are added here; status DEFAULT remains OPEN (legacy).
-- New requests are created with status=ACTIVE explicitly in the service layer.

ALTER TYPE "RequestStatus" ADD VALUE IF NOT EXISTS 'ACTIVE';
ALTER TYPE "RequestStatus" ADD VALUE IF NOT EXISTS 'IN_PROGRESS';
ALTER TYPE "RequestStatus" ADD VALUE IF NOT EXISTS 'EXPIRED';

ALTER TABLE "BloodRequest"
  ADD COLUMN IF NOT EXISTS "expiresAt" TIMESTAMP(3),
  ADD COLUMN IF NOT EXISTS "reason"    TEXT;
