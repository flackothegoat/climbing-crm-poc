CREATE TYPE "HoldCategorySource" AS ENUM ('DEFAULT', 'CUSTOM');

ALTER TABLE "HoldCategory"
ADD COLUMN "source" "HoldCategorySource" NOT NULL DEFAULT 'CUSTOM';

UPDATE "HoldCategory"
SET "source" = 'DEFAULT'
WHERE "code" LIKE 'SYSTEM-%';

DROP INDEX IF EXISTS "HoldVariant_holdModelId_activeColorName_key";
ALTER TABLE "HoldVariant" DROP COLUMN IF EXISTS "activeColorName";

ALTER TABLE "HoldInventoryMovement"
ADD COLUMN "requestKey" TEXT,
ADD COLUMN "requestFingerprint" TEXT;

CREATE UNIQUE INDEX "HoldInventoryMovement_requestKey_key"
ON "HoldInventoryMovement"("requestKey");

CREATE UNIQUE INDEX "HoldAsset_scanId_readyModel_key"
ON "HoldAsset"("scanId")
WHERE "kind" = 'MODEL_3D' AND "status" = 'READY';

CREATE UNIQUE INDEX "HoldAsset_specificationId_readyModel_key"
ON "HoldAsset"("specificationId")
WHERE "specificationId" IS NOT NULL
  AND "kind" = 'MODEL_3D'
  AND "status" = 'READY';

ALTER TABLE "HoldInitializationEntry"
ADD CONSTRAINT "HoldInitializationEntry_non_negative_counts_check"
CHECK ("warehouseQuantity" >= 0 AND "installedQuantity" >= 0),
ADD CONSTRAINT "HoldInitializationEntry_positive_total_check"
CHECK (("warehouseQuantity" + "installedQuantity") > 0);

ALTER TABLE "HoldInitializationBatch"
ADD CONSTRAINT "HoldInitializationBatch_active_key_state_check"
CHECK (
  ("status" = 'ACTIVE' AND "activeKey" = "organizationId")
  OR ("status" <> 'ACTIVE' AND "activeKey" IS NULL)
);
