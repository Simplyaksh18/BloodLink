-- AlterTable
ALTER TABLE "User" ADD COLUMN     "donorEligibilityExpiry" TIMESTAMP(3),
ADD COLUMN     "donorEligibleSince" TIMESTAMP(3),
ADD COLUMN     "isDonorEligible" BOOLEAN NOT NULL DEFAULT false;

-- CreateTable
CREATE TABLE "HealthScreening" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "screeningDate" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "height" DOUBLE PRECISION,
    "weight" DOUBLE PRECISION,
    "bmi" DOUBLE PRECISION,
    "bloodPressure" TEXT,
    "hemoglobinLevel" DOUBLE PRECISION,
    "pulseRate" INTEGER,
    "temperature" DOUBLE PRECISION,
    "hasHeartDisease" BOOLEAN NOT NULL DEFAULT false,
    "hasDiabetes" BOOLEAN NOT NULL DEFAULT false,
    "hasHepatitis" BOOLEAN NOT NULL DEFAULT false,
    "hasHiv" BOOLEAN NOT NULL DEFAULT false,
    "hasTuberculosis" BOOLEAN NOT NULL DEFAULT false,
    "hasCancer" BOOLEAN NOT NULL DEFAULT false,
    "hasBleedingDisorder" BOOLEAN NOT NULL DEFAULT false,
    "hasSeizureDisorder" BOOLEAN NOT NULL DEFAULT false,
    "hasKidneyDisease" BOOLEAN NOT NULL DEFAULT false,
    "hasLiverDisease" BOOLEAN NOT NULL DEFAULT false,
    "hasRespiratoryDisease" BOOLEAN NOT NULL DEFAULT false,
    "hasAutoimmuneDisease" BOOLEAN NOT NULL DEFAULT false,
    "hasRecentSurgery" BOOLEAN NOT NULL DEFAULT false,
    "recentSurgeryDate" TIMESTAMP(3),
    "hasRecentTattoo" BOOLEAN NOT NULL DEFAULT false,
    "recentTattooDate" TIMESTAMP(3),
    "hasRecentPiercing" BOOLEAN NOT NULL DEFAULT false,
    "recentPiercingDate" TIMESTAMP(3),
    "hasRecentTravel" BOOLEAN NOT NULL DEFAULT false,
    "recentTravelCountry" TEXT,
    "hasRecentVaccination" BOOLEAN NOT NULL DEFAULT false,
    "recentVaccinationDate" TIMESTAMP(3),
    "hasDonatedBefore" BOOLEAN NOT NULL DEFAULT false,
    "hasAdverseReaction" BOOLEAN NOT NULL DEFAULT false,
    "adverseReactionDetail" TEXT,
    "isOnMedication" BOOLEAN NOT NULL DEFAULT false,
    "medicationDetails" TEXT,
    "isPregnant" BOOLEAN NOT NULL DEFAULT false,
    "isBreastfeeding" BOOLEAN NOT NULL DEFAULT false,
    "hasConsumedAlcohol24h" BOOLEAN NOT NULL DEFAULT false,
    "hasFever" BOOLEAN NOT NULL DEFAULT false,
    "weightMeetsMinimum" BOOLEAN NOT NULL DEFAULT false,
    "screeningPassed" BOOLEAN NOT NULL,
    "disqualifyingFactors" TEXT,
    "reviewedBy" TEXT,
    "reviewedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "HealthScreening_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "HealthScreening_userId_key" ON "HealthScreening"("userId");

-- CreateIndex
CREATE INDEX "HealthScreening_userId_idx" ON "HealthScreening"("userId");

-- CreateIndex
CREATE INDEX "HealthScreening_screeningPassed_idx" ON "HealthScreening"("screeningPassed");

-- AddForeignKey
ALTER TABLE "HealthScreening" ADD CONSTRAINT "HealthScreening_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
