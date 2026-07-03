-- CreateEnum
CREATE TYPE "DevicePlatform" AS ENUM ('IOS', 'ANDROID', 'WEB', 'EXPO', 'UNKNOWN');

-- CreateTable
CREATE TABLE "UserDeviceToken" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "token" TEXT NOT NULL,
    "platform" "DevicePlatform" NOT NULL DEFAULT 'UNKNOWN',
    "deviceId" TEXT,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "lastSeenAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "UserDeviceToken_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "UserDeviceToken_userId_isActive_idx" ON "UserDeviceToken"("userId", "isActive");

-- CreateIndex
CREATE UNIQUE INDEX "UserDeviceToken_userId_token_key" ON "UserDeviceToken"("userId", "token");

-- AddForeignKey
ALTER TABLE "UserDeviceToken" ADD CONSTRAINT "UserDeviceToken_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
