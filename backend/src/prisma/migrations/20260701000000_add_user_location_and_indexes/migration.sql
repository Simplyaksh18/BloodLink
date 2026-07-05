-- Manual migration authored to close schema drift.
-- Idempotent by design.

-- AddColumn
ALTER TABLE "User" ADD COLUMN IF NOT EXISTS "location" TEXT;

-- CreateIndex
CREATE INDEX IF NOT EXISTS "User_donorStatus_idx"
  ON "User"("donorStatus");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "User_city_idx"
  ON "User"("city");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "BloodRequest_requesterId_idx"
  ON "BloodRequest"("requesterId");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "BloodRequest_bloodBankId_idx"
  ON "BloodRequest"("bloodBankId");