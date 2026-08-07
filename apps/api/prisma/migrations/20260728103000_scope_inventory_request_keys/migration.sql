DROP INDEX "HoldInventoryMovement_requestKey_key";

CREATE UNIQUE INDEX "HoldInventoryMovement_organizationId_requestKey_key"
ON "HoldInventoryMovement"("organizationId", "requestKey");
