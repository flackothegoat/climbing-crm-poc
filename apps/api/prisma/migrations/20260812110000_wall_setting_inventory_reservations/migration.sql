CREATE TYPE "WallSettingReservationStatus" AS ENUM ('ACTIVE', 'CONSUMED', 'RELEASED');

ALTER TABLE "WallSettingJob"
  ADD COLUMN "lockRequestKey" TEXT,
  ADD COLUMN "cancelRequestKey" TEXT,
  ADD COLUMN "completeRequestKey" TEXT;

ALTER TABLE "WallSettingJobSegment" ADD COLUMN "activeKey" TEXT;

CREATE TABLE "WallSettingJobHoldReservation" (
  "id" TEXT NOT NULL,
  "organizationId" TEXT NOT NULL,
  "settingJobId" TEXT NOT NULL,
  "holdVariantId" TEXT NOT NULL,
  "quantity" INTEGER NOT NULL,
  "status" "WallSettingReservationStatus" NOT NULL DEFAULT 'ACTIVE',
  "releasedAt" TIMESTAMP(3),
  "consumedAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "WallSettingJobHoldReservation_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "WallSettingJobHoldReservation_quantity_check" CHECK ("quantity" > 0),
  CONSTRAINT "WallSettingJobHoldReservation_status_check" CHECK (
    ("status" = 'ACTIVE' AND "releasedAt" IS NULL AND "consumedAt" IS NULL)
    OR ("status" = 'RELEASED' AND "releasedAt" IS NOT NULL AND "consumedAt" IS NULL)
    OR ("status" = 'CONSUMED' AND "consumedAt" IS NOT NULL AND "releasedAt" IS NULL)
  )
);

CREATE UNIQUE INDEX "WallSettingJob_organizationId_lockRequestKey_key"
  ON "WallSettingJob"("organizationId", "lockRequestKey");
CREATE UNIQUE INDEX "WallSettingJob_organizationId_cancelRequestKey_key"
  ON "WallSettingJob"("organizationId", "cancelRequestKey");
CREATE UNIQUE INDEX "WallSettingJob_organizationId_completeRequestKey_key"
  ON "WallSettingJob"("organizationId", "completeRequestKey");
CREATE UNIQUE INDEX "WallSettingJobSegment_activeKey_key"
  ON "WallSettingJobSegment"("activeKey");
CREATE UNIQUE INDEX "WallSettingJobHoldReservation_settingJobId_holdVariantId_key"
  ON "WallSettingJobHoldReservation"("settingJobId", "holdVariantId");
CREATE INDEX "WallSettingJobHoldReservation_organizationId_status_idx"
  ON "WallSettingJobHoldReservation"("organizationId", "status");
CREATE INDEX "WallSettingJobHoldReservation_holdVariantId_status_idx"
  ON "WallSettingJobHoldReservation"("holdVariantId", "status");

ALTER TABLE "WallSettingJobHoldReservation"
  ADD CONSTRAINT "WallSettingJobHoldReservation_organizationId_fkey"
  FOREIGN KEY ("organizationId") REFERENCES "Organization"("id")
  ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "WallSettingJobHoldReservation"
  ADD CONSTRAINT "WallSettingJobHoldReservation_settingJobId_fkey"
  FOREIGN KEY ("settingJobId") REFERENCES "WallSettingJob"("id")
  ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "WallSettingJobHoldReservation"
  ADD CONSTRAINT "WallSettingJobHoldReservation_holdVariantId_fkey"
  FOREIGN KEY ("holdVariantId") REFERENCES "HoldVariant"("id")
  ON DELETE RESTRICT ON UPDATE CASCADE;

CREATE OR REPLACE FUNCTION "assert_wall_setting_reservation_scope"() RETURNS trigger AS $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM "WallSettingJob" job
    JOIN "HoldVariant" variant ON variant."id" = NEW."holdVariantId"
    JOIN "HoldModel" model ON model."id" = variant."holdModelId"
    WHERE job."id" = NEW."settingJobId"
      AND job."organizationId" = NEW."organizationId"
      AND model."organizationId" = NEW."organizationId"
  ) THEN
    RAISE EXCEPTION USING ERRCODE = '23514', MESSAGE = 'WallSettingJobHoldReservation scope mismatch';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER "WallSettingJobHoldReservation_scope_guard"
BEFORE INSERT OR UPDATE ON "WallSettingJobHoldReservation"
FOR EACH ROW EXECUTE FUNCTION "assert_wall_setting_reservation_scope"();
