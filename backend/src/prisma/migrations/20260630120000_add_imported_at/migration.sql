-- Add importedAt to User for CSV import timestamp tracking
-- Nullable: safe to add to existing rows (all existing rows get NULL)
ALTER TABLE "User" ADD COLUMN IF NOT EXISTS "importedAt" TIMESTAMP(3);
