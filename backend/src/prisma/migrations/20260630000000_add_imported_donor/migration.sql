-- Add importedDonor flag and age to User
-- Both columns are safe to add to existing rows:
--   importedDonor defaults to false (existing users are not CSV imports)
--   age is nullable (existing users have no age on record)

ALTER TABLE "User" ADD COLUMN IF NOT EXISTS "importedDonor" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "User" ADD COLUMN IF NOT EXISTS "age" INTEGER;

-- Index on importedDonor so the discovery query is fast
CREATE INDEX IF NOT EXISTS "User_importedDonor_idx" ON "User"("importedDonor");
