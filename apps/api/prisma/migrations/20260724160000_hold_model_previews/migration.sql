ALTER TYPE "HoldAssetKind" ADD VALUE 'MODEL_PREVIEW';

ALTER TABLE "HoldAsset" ADD COLUMN "sourceAssetId" TEXT;

CREATE UNIQUE INDEX "HoldAsset_sourceAssetId_key" ON "HoldAsset"("sourceAssetId");

ALTER TABLE "HoldAsset"
ADD CONSTRAINT "HoldAsset_sourceAssetId_fkey"
FOREIGN KEY ("sourceAssetId") REFERENCES "HoldAsset"("id")
ON DELETE RESTRICT ON UPDATE CASCADE;
