-- Preserve the immutable phone-scan GLB separately from the catalog-ready result.
ALTER TYPE "HoldAssetKind" ADD VALUE 'MODEL_SOURCE' BEFORE 'MODEL_3D';

CREATE TYPE "HoldModelProcessingStatus" AS ENUM (
  'QUEUED',
  'PROCESSING',
  'COMPLETED',
  'NEEDS_REVIEW',
  'FAILED',
  'CANCELLED'
);

CREATE TABLE "HoldModelProcessingJob" (
  "id" TEXT NOT NULL,
  "organizationId" TEXT NOT NULL,
  "scanId" TEXT NOT NULL,
  "sourceAssetId" TEXT NOT NULL,
  "outputAssetId" TEXT,
  "status" "HoldModelProcessingStatus" NOT NULL DEFAULT 'QUEUED',
  "processorVersion" INTEGER NOT NULL DEFAULT 1,
  "attemptCount" INTEGER NOT NULL DEFAULT 0,
  "errorCode" TEXT,
  "errorMessage" TEXT,
  "report" JSONB,
  "requestedByAccountId" TEXT NOT NULL,
  "startedAt" TIMESTAMP(3),
  "completedAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "HoldModelProcessingJob_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "HoldModelProcessingJob_sourceAssetId_key"
  ON "HoldModelProcessingJob"("sourceAssetId");
CREATE UNIQUE INDEX "HoldModelProcessingJob_outputAssetId_key"
  ON "HoldModelProcessingJob"("outputAssetId");
CREATE INDEX "HoldModelProcessingJob_organizationId_status_createdAt_idx"
  ON "HoldModelProcessingJob"("organizationId", "status", "createdAt");
CREATE INDEX "HoldModelProcessingJob_scanId_createdAt_idx"
  ON "HoldModelProcessingJob"("scanId", "createdAt");

ALTER TABLE "HoldModelProcessingJob"
  ADD CONSTRAINT "HoldModelProcessingJob_organizationId_fkey"
  FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "HoldModelProcessingJob"
  ADD CONSTRAINT "HoldModelProcessingJob_scanId_fkey"
  FOREIGN KEY ("scanId") REFERENCES "HoldScan"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "HoldModelProcessingJob"
  ADD CONSTRAINT "HoldModelProcessingJob_sourceAssetId_fkey"
  FOREIGN KEY ("sourceAssetId") REFERENCES "HoldAsset"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "HoldModelProcessingJob"
  ADD CONSTRAINT "HoldModelProcessingJob_outputAssetId_fkey"
  FOREIGN KEY ("outputAssetId") REFERENCES "HoldAsset"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "HoldModelProcessingJob"
  ADD CONSTRAINT "HoldModelProcessingJob_requestedByAccountId_fkey"
  FOREIGN KEY ("requestedByAccountId") REFERENCES "Account"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
