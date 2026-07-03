-- Phase 4 Step 2: DonorRequestResponse table
-- Tracks each donor's ACCEPTED / DECLINED response to a blood request.
-- Unique constraint on (requestId, donorId) — one response per donor per request;
-- updates are done via upsert in the service layer.

CREATE TYPE "DonorResponseStatus" AS ENUM ('ACCEPTED', 'DECLINED');

CREATE TABLE "DonorRequestResponse" (
  "id"        TEXT         NOT NULL,
  "requestId" TEXT         NOT NULL,
  "donorId"   TEXT         NOT NULL,
  "response"  "DonorResponseStatus" NOT NULL,
  "message"   TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,

  CONSTRAINT "DonorRequestResponse_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "DonorRequestResponse_requestId_donorId_key"
  ON "DonorRequestResponse"("requestId", "donorId");

CREATE INDEX "DonorRequestResponse_requestId_idx"
  ON "DonorRequestResponse"("requestId");

CREATE INDEX "DonorRequestResponse_donorId_idx"
  ON "DonorRequestResponse"("donorId");

ALTER TABLE "DonorRequestResponse"
  ADD CONSTRAINT "DonorRequestResponse_requestId_fkey"
    FOREIGN KEY ("requestId") REFERENCES "BloodRequest"("id")
    ON DELETE CASCADE ON UPDATE CASCADE,
  ADD CONSTRAINT "DonorRequestResponse_donorId_fkey"
    FOREIGN KEY ("donorId") REFERENCES "User"("id")
    ON DELETE CASCADE ON UPDATE CASCADE;
