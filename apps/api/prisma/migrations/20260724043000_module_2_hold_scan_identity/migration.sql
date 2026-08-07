CREATE TYPE "HoldIdentitySource" AS ENUM ('MANUAL', 'SCAN');

ALTER TABLE "HoldModel"
  ADD COLUMN "identitySource" "HoldIdentitySource" NOT NULL DEFAULT 'MANUAL',
  ADD COLUMN "scanFingerprint" TEXT;

CREATE INDEX "HoldModel_scanFingerprint_idx" ON "HoldModel"("scanFingerprint");
