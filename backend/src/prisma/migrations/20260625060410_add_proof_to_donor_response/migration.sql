-- AlterTable
ALTER TABLE "DonorRequestResponse" ADD COLUMN     "proofImageUrl" TEXT,
ADD COLUMN     "proofNote" TEXT,
ADD COLUMN     "proofSubmittedAt" TIMESTAMP(3);
