-- 模块 2.3A.1：颜色版本生命周期与可追溯的入库撤销。
ALTER TYPE "InventoryMovementType" ADD VALUE 'REVERSAL';

ALTER TABLE "HoldVariant"
  ADD COLUMN "status" "HoldStatus" NOT NULL DEFAULT 'ACTIVE';

ALTER TABLE "HoldInventoryMovement"
  ADD COLUMN "reversalOfMovementId" TEXT;

CREATE UNIQUE INDEX "HoldInventoryMovement_reversalOfMovementId_key"
  ON "HoldInventoryMovement"("reversalOfMovementId");

CREATE INDEX "HoldVariant_holdModelId_status_idx"
  ON "HoldVariant"("holdModelId", "status");

ALTER TABLE "HoldInventoryMovement"
  ADD CONSTRAINT "HoldInventoryMovement_reversalOfMovementId_fkey"
  FOREIGN KEY ("reversalOfMovementId") REFERENCES "HoldInventoryMovement"("id")
  ON DELETE RESTRICT ON UPDATE CASCADE;
