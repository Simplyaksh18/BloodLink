-- CreateEnum
CREATE TYPE "VerificationType" AS ENUM ('ID_PROOF', 'BLOOD_GROUP_PROOF', 'MEDICAL_SCREENING', 'LICENSE');

-- CreateEnum
CREATE TYPE "VerificationStatus" AS ENUM ('NOT_SUBMITTED', 'UPLOADED', 'AUTO_VERIFICATION_PASSED', 'AUTO_VERIFICATION_FAILED', 'PENDING_REVIEW', 'VERIFIED', 'REJECTED', 'EXPIRED');

-- AlterTable
ALTER TABLE "User" ADD COLUMN     "bloodGroupVerified" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "idVerified" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "medicalVerified" BOOLEAN NOT NULL DEFAULT false;

-- CreateTable
CREATE TABLE "Verification" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "verificationType" "VerificationType" NOT NULL,
    "status" "VerificationStatus" NOT NULL DEFAULT 'NOT_SUBMITTED',
    "s3Key" TEXT,
    "fileName" TEXT,
    "fileType" TEXT,
    "fileSize" INTEGER,
    "uploadedAt" TIMESTAMP(3),
    "autoCheckPassed" BOOLEAN,
    "autoCheckResults" JSONB,
    "fraudScore" INTEGER NOT NULL DEFAULT 0,
    "fraudFlags" JSONB,
    "reviewerId" TEXT,
    "reviewedAt" TIMESTAMP(3),
    "reviewNotes" TEXT,
    "rejectionReason" TEXT,
    "documentDate" TIMESTAMP(3),
    "expiresAt" TIMESTAMP(3),
    "isExpired" BOOLEAN NOT NULL DEFAULT false,
    "resubmissionCount" INTEGER NOT NULL DEFAULT 0,
    "previousVersionId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Verification_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "FraudAlert" (
    "id" TEXT NOT NULL,
    "verificationId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "alertType" TEXT NOT NULL,
    "severity" INTEGER NOT NULL,
    "description" TEXT NOT NULL,
    "metadata" JSONB,
    "isResolved" BOOLEAN NOT NULL DEFAULT false,
    "resolvedBy" TEXT,
    "resolvedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "FraudAlert_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "Verification_userId_verificationType_idx" ON "Verification"("userId", "verificationType");

-- CreateIndex
CREATE INDEX "Verification_status_idx" ON "Verification"("status");

-- CreateIndex
CREATE INDEX "Verification_fraudScore_idx" ON "Verification"("fraudScore");

-- CreateIndex
CREATE INDEX "FraudAlert_verificationId_idx" ON "FraudAlert"("verificationId");

-- CreateIndex
CREATE INDEX "FraudAlert_userId_idx" ON "FraudAlert"("userId");

-- CreateIndex
CREATE INDEX "FraudAlert_isResolved_idx" ON "FraudAlert"("isResolved");

-- AddForeignKey
ALTER TABLE "Verification" ADD CONSTRAINT "Verification_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Verification" ADD CONSTRAINT "Verification_reviewerId_fkey" FOREIGN KEY ("reviewerId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "FraudAlert" ADD CONSTRAINT "FraudAlert_verificationId_fkey" FOREIGN KEY ("verificationId") REFERENCES "Verification"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "FraudAlert" ADD CONSTRAINT "FraudAlert_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
