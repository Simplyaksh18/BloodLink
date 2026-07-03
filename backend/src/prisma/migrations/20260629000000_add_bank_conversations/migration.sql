-- AlterTable: make requestId nullable, add bank conversation fields
ALTER TABLE "Conversation"
  ADD COLUMN IF NOT EXISTS "bankId" TEXT,
  ADD COLUMN IF NOT EXISTS "bankName" TEXT,
  ALTER COLUMN "requestId" DROP NOT NULL;

-- Drop old FK (was Cascade on non-null field) and replace with SetNull on nullable field
ALTER TABLE "Conversation"
  DROP CONSTRAINT IF EXISTS "Conversation_requestId_fkey";

ALTER TABLE "Conversation"
  ADD CONSTRAINT "Conversation_requestId_fkey"
  FOREIGN KEY ("requestId") REFERENCES "BloodRequest"("id")
  ON DELETE SET NULL ON UPDATE CASCADE;
