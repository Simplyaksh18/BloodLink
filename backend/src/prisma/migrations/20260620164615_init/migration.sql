-- CreateEnum
CREATE TYPE "UserRole" AS ENUM ('SUPER_ADMIN', 'ADMIN', 'USER');

-- CreateEnum
CREATE TYPE "EmergencyPriority" AS ENUM ('RED', 'YELLOW', 'GREEN');

-- CreateEnum
CREATE TYPE "DonorVerificationStatus" AS ENUM ('PENDING', 'ELIGIBLE', 'UNDER_REVIEW', 'NOT_ELIGIBLE');

-- CreateEnum
CREATE TYPE "RequestVerificationStatus" AS ENUM ('PENDING', 'APPROVED', 'REJECTED');

-- CreateEnum
CREATE TYPE "RequestStatus" AS ENUM ('OPEN', 'FULFILLED', 'CANCELLED');

-- CreateTable
CREATE TABLE "User" (
    "id" TEXT NOT NULL,
    "phone" TEXT NOT NULL,
    "email" TEXT,
    "passwordHash" TEXT,
    "name" TEXT NOT NULL,
    "gender" TEXT,
    "avatarUrl" TEXT,
    "role" "UserRole" NOT NULL DEFAULT 'USER',
    "isDonor" BOOLEAN NOT NULL DEFAULT false,
    "bloodGroup" TEXT,
    "lastDonationDate" TIMESTAMP(3),
    "totalDonations" INTEGER NOT NULL DEFAULT 0,
    "willingToDonate" BOOLEAN NOT NULL DEFAULT false,
    "donorVerificationStatus" "DonorVerificationStatus" NOT NULL DEFAULT 'PENDING',
    "medicalCertificateUrl" TEXT,
    "latitude" DOUBLE PRECISION,
    "longitude" DOUBLE PRECISION,
    "address" TEXT,
    "city" TEXT,
    "state" TEXT,
    "pincode" TEXT,
    "emergencyContactName" TEXT,
    "emergencyContactPhone" TEXT,
    "emergencyContactRelation" TEXT,
    "deviceToken" TEXT,
    "lastLoginAt" TIMESTAMP(3),
    "lastActiveAt" TIMESTAMP(3),
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "isDeleted" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "User_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "UserDocument" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "documentType" TEXT NOT NULL,
    "url" TEXT NOT NULL,
    "fileName" TEXT NOT NULL,
    "mimeType" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'uploaded',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "UserDocument_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "BloodBank" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "registrationNumber" TEXT NOT NULL,
    "contactPhone" TEXT NOT NULL,
    "email" TEXT,
    "operatingHoursStart" TEXT NOT NULL,
    "operatingHoursEnd" TEXT NOT NULL,
    "is24x7" BOOLEAN NOT NULL DEFAULT false,
    "stockJson" TEXT NOT NULL DEFAULT '{}',
    "latitude" DOUBLE PRECISION NOT NULL,
    "longitude" DOUBLE PRECISION NOT NULL,
    "address" TEXT NOT NULL,
    "city" TEXT NOT NULL,
    "state" TEXT NOT NULL,
    "pincode" TEXT NOT NULL,
    "isVerified" BOOLEAN NOT NULL DEFAULT false,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "BloodBank_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "BloodRequest" (
    "id" TEXT NOT NULL,
    "requesterId" TEXT NOT NULL,
    "bloodGroup" TEXT NOT NULL,
    "units" INTEGER NOT NULL DEFAULT 1,
    "patientName" TEXT,
    "patientAge" INTEGER,
    "patientGender" TEXT,
    "hospitalName" TEXT NOT NULL,
    "hospitalAddress" TEXT NOT NULL,
    "hospitalCity" TEXT NOT NULL,
    "hospitalLatitude" DOUBLE PRECISION,
    "hospitalLongitude" DOUBLE PRECISION,
    "hospitalContact" TEXT,
    "doctorName" TEXT,
    "doctorContact" TEXT,
    "emergencyLevel" "EmergencyPriority" NOT NULL,
    "status" "RequestStatus" NOT NULL DEFAULT 'OPEN',
    "verificationStatus" "RequestVerificationStatus" NOT NULL DEFAULT 'PENDING',
    "notes" TEXT,
    "requiredBy" TIMESTAMP(3),
    "fulfilledAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "BloodRequest_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "RequestDocument" (
    "id" TEXT NOT NULL,
    "requestId" TEXT NOT NULL,
    "documentType" TEXT NOT NULL,
    "url" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "RequestDocument_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Donation" (
    "id" TEXT NOT NULL,
    "donorId" TEXT NOT NULL,
    "requestId" TEXT,
    "bloodGroup" TEXT NOT NULL,
    "units" INTEGER NOT NULL DEFAULT 1,
    "isVerified" BOOLEAN NOT NULL DEFAULT false,
    "donationDate" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Donation_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Notification" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "body" TEXT NOT NULL,
    "notificationType" TEXT NOT NULL,
    "relatedRequestId" TEXT,
    "data" TEXT,
    "isRead" BOOLEAN NOT NULL DEFAULT false,
    "isPushSent" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Notification_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "OtpCode" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "phone" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "used" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "OtpCode_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "User_phone_key" ON "User"("phone");

-- CreateIndex
CREATE UNIQUE INDEX "User_email_key" ON "User"("email");

-- CreateIndex
CREATE INDEX "User_phone_idx" ON "User"("phone");

-- CreateIndex
CREATE INDEX "User_bloodGroup_willingToDonate_idx" ON "User"("bloodGroup", "willingToDonate");

-- CreateIndex
CREATE INDEX "User_latitude_longitude_idx" ON "User"("latitude", "longitude");

-- CreateIndex
CREATE INDEX "UserDocument_userId_documentType_idx" ON "UserDocument"("userId", "documentType");

-- CreateIndex
CREATE UNIQUE INDEX "BloodBank_registrationNumber_key" ON "BloodBank"("registrationNumber");

-- CreateIndex
CREATE INDEX "BloodBank_latitude_longitude_idx" ON "BloodBank"("latitude", "longitude");

-- CreateIndex
CREATE INDEX "BloodRequest_bloodGroup_status_idx" ON "BloodRequest"("bloodGroup", "status");

-- CreateIndex
CREATE INDEX "BloodRequest_emergencyLevel_status_idx" ON "BloodRequest"("emergencyLevel", "status");

-- CreateIndex
CREATE INDEX "BloodRequest_hospitalLatitude_hospitalLongitude_idx" ON "BloodRequest"("hospitalLatitude", "hospitalLongitude");

-- CreateIndex
CREATE INDEX "BloodRequest_createdAt_idx" ON "BloodRequest"("createdAt");

-- CreateIndex
CREATE INDEX "Donation_donorId_idx" ON "Donation"("donorId");

-- CreateIndex
CREATE INDEX "Donation_donationDate_idx" ON "Donation"("donationDate");

-- CreateIndex
CREATE INDEX "Notification_userId_isRead_idx" ON "Notification"("userId", "isRead");

-- CreateIndex
CREATE INDEX "Notification_createdAt_idx" ON "Notification"("createdAt");

-- CreateIndex
CREATE INDEX "OtpCode_phone_used_idx" ON "OtpCode"("phone", "used");

-- AddForeignKey
ALTER TABLE "UserDocument" ADD CONSTRAINT "UserDocument_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "BloodRequest" ADD CONSTRAINT "BloodRequest_requesterId_fkey" FOREIGN KEY ("requesterId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RequestDocument" ADD CONSTRAINT "RequestDocument_requestId_fkey" FOREIGN KEY ("requestId") REFERENCES "BloodRequest"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Donation" ADD CONSTRAINT "Donation_donorId_fkey" FOREIGN KEY ("donorId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Donation" ADD CONSTRAINT "Donation_requestId_fkey" FOREIGN KEY ("requestId") REFERENCES "BloodRequest"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Notification" ADD CONSTRAINT "Notification_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Notification" ADD CONSTRAINT "Notification_relatedRequestId_fkey" FOREIGN KEY ("relatedRequestId") REFERENCES "BloodRequest"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "OtpCode" ADD CONSTRAINT "OtpCode_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
