-- CreateEnum
CREATE TYPE "BloodBankVerificationStatus" AS ENUM ('PENDING_REVIEW', 'VERIFIED', 'REJECTED');

-- CreateEnum
CREATE TYPE "InventoryStatus" AS ENUM ('ACTIVE', 'EXPIRED', 'RESERVED');

-- AlterTable
ALTER TABLE "BloodBank" ADD COLUMN     "licenseNumber" TEXT,
ADD COLUMN     "ownerId" TEXT,
ADD COLUMN     "rejectionReason" TEXT,
ADD COLUMN     "verificationStatus" "BloodBankVerificationStatus" NOT NULL DEFAULT 'PENDING_REVIEW',
ALTER COLUMN "registrationNumber" DROP NOT NULL,
ALTER COLUMN "operatingHoursStart" DROP NOT NULL,
ALTER COLUMN "operatingHoursEnd" DROP NOT NULL,
ALTER COLUMN "latitude" DROP NOT NULL,
ALTER COLUMN "longitude" DROP NOT NULL;

-- AlterTable
ALTER TABLE "BloodRequest" ADD COLUMN     "bloodBankId" TEXT;

-- CreateTable
CREATE TABLE "BloodInventory" (
    "id" TEXT NOT NULL,
    "bloodBankId" TEXT NOT NULL,
    "bloodGroup" TEXT NOT NULL,
    "units" INTEGER NOT NULL DEFAULT 0,
    "expiryDate" TIMESTAMP(3),
    "status" "InventoryStatus" NOT NULL DEFAULT 'ACTIVE',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "BloodInventory_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "BloodInventory_bloodBankId_bloodGroup_idx" ON "BloodInventory"("bloodBankId", "bloodGroup");

-- CreateIndex
CREATE INDEX "BloodInventory_expiryDate_idx" ON "BloodInventory"("expiryDate");

-- CreateIndex
CREATE INDEX "BloodInventory_status_idx" ON "BloodInventory"("status");

-- CreateIndex
CREATE INDEX "BloodBank_city_idx" ON "BloodBank"("city");

-- CreateIndex
CREATE INDEX "BloodBank_verificationStatus_idx" ON "BloodBank"("verificationStatus");

-- AddForeignKey
ALTER TABLE "BloodBank" ADD CONSTRAINT "BloodBank_ownerId_fkey" FOREIGN KEY ("ownerId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "BloodInventory" ADD CONSTRAINT "BloodInventory_bloodBankId_fkey" FOREIGN KEY ("bloodBankId") REFERENCES "BloodBank"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "BloodRequest" ADD CONSTRAINT "BloodRequest_bloodBankId_fkey" FOREIGN KEY ("bloodBankId") REFERENCES "BloodBank"("id") ON DELETE SET NULL ON UPDATE CASCADE;
