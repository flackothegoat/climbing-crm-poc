CREATE TYPE "HoldScanStatus" AS ENUM ('DRAFT', 'COMPLETED', 'CANCELLED');
CREATE TYPE "HoldAssetKind" AS ENUM (
  'MODEL_3D',
  'PHOTO_FRONT',
  'PHOTO_BACK',
  'PHOTO_MEASUREMENT',
  'PHOTO_OTHER'
);
CREATE TYPE "HoldAssetStatus" AS ENUM ('READY', 'FAILED');
CREATE TYPE "HoldInitializationStatus" AS ENUM ('ACTIVE', 'COMPLETED', 'CANCELLED');

CREATE TABLE "HoldInitializationBatch" (
  "id" TEXT NOT NULL,
  "organizationId" TEXT NOT NULL,
  "activeKey" TEXT,
  "name" TEXT NOT NULL,
  "status" "HoldInitializationStatus" NOT NULL DEFAULT 'ACTIVE',
  "startedByAccountId" TEXT NOT NULL,
  "completedByAccountId" TEXT,
  "completedAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "HoldInitializationBatch_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "HoldScan" (
  "id" TEXT NOT NULL,
  "organizationId" TEXT NOT NULL,
  "categoryId" TEXT NOT NULL,
  "specificationId" TEXT,
  "initializationBatchId" TEXT NOT NULL,
  "status" "HoldScanStatus" NOT NULL DEFAULT 'DRAFT',
  "note" TEXT,
  "createdByAccountId" TEXT NOT NULL,
  "completedAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "HoldScan_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "HoldAsset" (
  "id" TEXT NOT NULL,
  "organizationId" TEXT NOT NULL,
  "scanId" TEXT NOT NULL,
  "specificationId" TEXT,
  "kind" "HoldAssetKind" NOT NULL,
  "status" "HoldAssetStatus" NOT NULL DEFAULT 'READY',
  "objectKey" TEXT NOT NULL,
  "originalFileName" TEXT NOT NULL,
  "contentType" TEXT NOT NULL,
  "sizeBytes" INTEGER NOT NULL,
  "checksumSha256" TEXT NOT NULL,
  "metadata" JSONB,
  "createdByAccountId" TEXT NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "HoldAsset_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "HoldInitializationEntry" (
  "id" TEXT NOT NULL,
  "batchId" TEXT NOT NULL,
  "specificationId" TEXT NOT NULL,
  "scanId" TEXT,
  "warehouseQuantity" INTEGER NOT NULL,
  "installedQuantity" INTEGER NOT NULL,
  "note" TEXT,
  "createdByAccountId" TEXT NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "HoldInitializationEntry_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "HoldInitializationBatch_activeKey_key"
  ON "HoldInitializationBatch"("activeKey");
CREATE INDEX "HoldInitializationBatch_organizationId_status_createdAt_idx"
  ON "HoldInitializationBatch"("organizationId", "status", "createdAt");
CREATE INDEX "HoldScan_organizationId_status_createdAt_idx"
  ON "HoldScan"("organizationId", "status", "createdAt");
CREATE INDEX "HoldScan_categoryId_idx" ON "HoldScan"("categoryId");
CREATE INDEX "HoldScan_specificationId_idx" ON "HoldScan"("specificationId");
CREATE INDEX "HoldScan_initializationBatchId_idx" ON "HoldScan"("initializationBatchId");
CREATE UNIQUE INDEX "HoldAsset_objectKey_key" ON "HoldAsset"("objectKey");
CREATE INDEX "HoldAsset_organizationId_createdAt_idx"
  ON "HoldAsset"("organizationId", "createdAt");
CREATE INDEX "HoldAsset_scanId_kind_idx" ON "HoldAsset"("scanId", "kind");
CREATE INDEX "HoldAsset_specificationId_kind_idx"
  ON "HoldAsset"("specificationId", "kind");
CREATE UNIQUE INDEX "HoldInitializationEntry_scanId_key"
  ON "HoldInitializationEntry"("scanId");
CREATE UNIQUE INDEX "HoldInitializationEntry_batchId_specificationId_key"
  ON "HoldInitializationEntry"("batchId", "specificationId");
CREATE INDEX "HoldInitializationEntry_specificationId_idx"
  ON "HoldInitializationEntry"("specificationId");

ALTER TABLE "HoldInitializationBatch"
  ADD CONSTRAINT "HoldInitializationBatch_organizationId_fkey"
  FOREIGN KEY ("organizationId") REFERENCES "Organization"("id")
  ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "HoldInitializationBatch"
  ADD CONSTRAINT "HoldInitializationBatch_startedByAccountId_fkey"
  FOREIGN KEY ("startedByAccountId") REFERENCES "Account"("id")
  ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "HoldInitializationBatch"
  ADD CONSTRAINT "HoldInitializationBatch_completedByAccountId_fkey"
  FOREIGN KEY ("completedByAccountId") REFERENCES "Account"("id")
  ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "HoldScan"
  ADD CONSTRAINT "HoldScan_organizationId_fkey"
  FOREIGN KEY ("organizationId") REFERENCES "Organization"("id")
  ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "HoldScan"
  ADD CONSTRAINT "HoldScan_categoryId_fkey"
  FOREIGN KEY ("categoryId") REFERENCES "HoldCategory"("id")
  ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "HoldScan"
  ADD CONSTRAINT "HoldScan_specificationId_fkey"
  FOREIGN KEY ("specificationId") REFERENCES "HoldVariant"("id")
  ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "HoldScan"
  ADD CONSTRAINT "HoldScan_initializationBatchId_fkey"
  FOREIGN KEY ("initializationBatchId") REFERENCES "HoldInitializationBatch"("id")
  ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "HoldScan"
  ADD CONSTRAINT "HoldScan_createdByAccountId_fkey"
  FOREIGN KEY ("createdByAccountId") REFERENCES "Account"("id")
  ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "HoldAsset"
  ADD CONSTRAINT "HoldAsset_organizationId_fkey"
  FOREIGN KEY ("organizationId") REFERENCES "Organization"("id")
  ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "HoldAsset"
  ADD CONSTRAINT "HoldAsset_scanId_fkey"
  FOREIGN KEY ("scanId") REFERENCES "HoldScan"("id")
  ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "HoldAsset"
  ADD CONSTRAINT "HoldAsset_specificationId_fkey"
  FOREIGN KEY ("specificationId") REFERENCES "HoldVariant"("id")
  ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "HoldAsset"
  ADD CONSTRAINT "HoldAsset_createdByAccountId_fkey"
  FOREIGN KEY ("createdByAccountId") REFERENCES "Account"("id")
  ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "HoldInitializationEntry"
  ADD CONSTRAINT "HoldInitializationEntry_batchId_fkey"
  FOREIGN KEY ("batchId") REFERENCES "HoldInitializationBatch"("id")
  ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "HoldInitializationEntry"
  ADD CONSTRAINT "HoldInitializationEntry_specificationId_fkey"
  FOREIGN KEY ("specificationId") REFERENCES "HoldVariant"("id")
  ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "HoldInitializationEntry"
  ADD CONSTRAINT "HoldInitializationEntry_scanId_fkey"
  FOREIGN KEY ("scanId") REFERENCES "HoldScan"("id")
  ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "HoldInitializationEntry"
  ADD CONSTRAINT "HoldInitializationEntry_createdByAccountId_fkey"
  FOREIGN KEY ("createdByAccountId") REFERENCES "Account"("id")
  ON DELETE RESTRICT ON UPDATE CASCADE;
