-- Canonical targeted-donor migration.
-- Runs first alphabetically (080255 < 200000).
-- All steps are idempotent so re-running on an existing DB is safe.

-- Step 1: Add column (must exist before index or FK)
ALTER TABLE "BloodRequest" ADD COLUMN IF NOT EXISTS "targetedDonorId" TEXT;

-- Step 2: Index
CREATE INDEX IF NOT EXISTS "BloodRequest_targetedDonorId_idx" ON "BloodRequest"("targetedDonorId");

-- Step 3: Related index adjustments from the same schema revision
DROP INDEX IF EXISTS "User_importedDonor_idx";
CREATE INDEX IF NOT EXISTS "Conversation_bankId_idx" ON "Conversation"("bankId");

-- Step 4: FK constraint (idempotent wrapper — no-op if already present)
DO $$ BEGIN
  ALTER TABLE "BloodRequest"
    ADD CONSTRAINT "BloodRequest_targetedDonorId_fkey"
    FOREIGN KEY ("targetedDonorId") REFERENCES "User"("id")
    ON DELETE SET NULL ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;
