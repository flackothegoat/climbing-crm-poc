ALTER TYPE "InventoryMovementType" ADD VALUE 'RECORD_DELETION';
ALTER TYPE "HoldAssetStatus" ADD VALUE 'DELETED';

ALTER TABLE "HoldVariant"
  ADD COLUMN "activeColorName" TEXT,
  ADD COLUMN "activeColorKey" TEXT,
  ADD COLUMN "deletedAt" TIMESTAMP(3),
  ADD COLUMN "deletedByAccountId" TEXT,
  ADD COLUMN "deletionReason" TEXT,
  ADD COLUMN "deletionSnapshot" JSONB;

UPDATE "HoldVariant"
SET
  "activeColorName" = "colorName",
  "activeColorKey" = "colorKey";

DROP INDEX "HoldVariant_holdModelId_colorName_key";
DROP INDEX "HoldVariant_holdModelId_colorKey_key";

CREATE UNIQUE INDEX "HoldVariant_holdModelId_activeColorName_key"
  ON "HoldVariant"("holdModelId", "activeColorName");
CREATE UNIQUE INDEX "HoldVariant_holdModelId_activeColorKey_key"
  ON "HoldVariant"("holdModelId", "activeColorKey");
CREATE INDEX "HoldVariant_holdModelId_deletedAt_idx"
  ON "HoldVariant"("holdModelId", "deletedAt");
CREATE INDEX "HoldVariant_deletedByAccountId_idx"
  ON "HoldVariant"("deletedByAccountId");

ALTER TABLE "HoldVariant"
  ADD CONSTRAINT "HoldVariant_deletedByAccountId_fkey"
  FOREIGN KEY ("deletedByAccountId") REFERENCES "Account"("id")
  ON DELETE RESTRICT ON UPDATE CASCADE;
