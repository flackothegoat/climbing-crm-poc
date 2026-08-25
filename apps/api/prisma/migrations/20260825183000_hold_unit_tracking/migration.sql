CREATE TYPE "HoldTrackingMode" AS ENUM ('QUANTITY', 'HYBRID', 'SERIALIZED');
CREATE TYPE "FacilityStatus" AS ENUM ('ACTIVE', 'ARCHIVED');
CREATE TYPE "HoldUnitPhysicalStatus" AS ENUM ('WAREHOUSE', 'INSTALLED', 'IN_TRANSIT', 'UNKNOWN');
CREATE TYPE "HoldUnitOperationalStatus" AS ENUM ('ACTIVE', 'MAINTENANCE', 'LOST', 'RETIRED');
CREATE TYPE "RfidTechnology" AS ENUM ('UHF_EPC_GEN2');
CREATE TYPE "RfidTagStatus" AS ENUM ('ACTIVE', 'LOST', 'DAMAGED', 'REPLACED');
CREATE TYPE "HoldUnitEventType" AS ENUM (
  'REGISTERED', 'TAG_BOUND', 'TAG_REPLACED', 'INVENTORY_CONFIRMED',
  'INSTALLED', 'REMOVED', 'LOAN_RESERVED', 'LOAN_DISPATCHED', 'LOAN_RECEIVED',
  'RETURN_DISPATCHED', 'RETURN_RECEIVED', 'MAINTENANCE_STARTED',
  'MAINTENANCE_COMPLETED', 'LOST', 'FOUND', 'RETIRED', 'CORRECTED'
);

ALTER TABLE "HoldVariant"
  ADD COLUMN "trackingMode" "HoldTrackingMode" NOT NULL DEFAULT 'QUANTITY';

CREATE TABLE "Facility" (
  "id" TEXT NOT NULL,
  "organizationId" TEXT NOT NULL,
  "code" TEXT NOT NULL,
  "name" TEXT NOT NULL,
  "status" "FacilityStatus" NOT NULL DEFAULT 'ACTIVE',
  "isDefault" BOOLEAN NOT NULL DEFAULT false,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "Facility_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "HoldUnitRegistrationBatch" (
  "id" TEXT NOT NULL,
  "organizationId" TEXT NOT NULL,
  "holdVariantId" TEXT NOT NULL,
  "facilityId" TEXT NOT NULL,
  "requestKey" TEXT NOT NULL,
  "physicalStatus" "HoldUnitPhysicalStatus" NOT NULL,
  "quantity" INTEGER NOT NULL,
  "createdByAccountId" TEXT NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "HoldUnitRegistrationBatch_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "HoldUnitRegistrationBatch_quantity_check" CHECK ("quantity" > 0)
);

CREATE TABLE "HoldUnit" (
  "id" TEXT NOT NULL,
  "assetCode" TEXT NOT NULL,
  "holdVariantId" TEXT NOT NULL,
  "ownerOrganizationId" TEXT NOT NULL,
  "currentCustodianOrganizationId" TEXT NOT NULL,
  "currentFacilityId" TEXT NOT NULL,
  "registrationBatchId" TEXT NOT NULL,
  "physicalStatus" "HoldUnitPhysicalStatus" NOT NULL,
  "operationalStatus" "HoldUnitOperationalStatus" NOT NULL DEFAULT 'ACTIVE',
  "version" INTEGER NOT NULL DEFAULT 0,
  "registeredByAccountId" TEXT NOT NULL,
  "retiredAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "HoldUnit_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "RfidTag" (
  "id" TEXT NOT NULL,
  "organizationId" TEXT NOT NULL,
  "technology" "RfidTechnology" NOT NULL DEFAULT 'UHF_EPC_GEN2',
  "epc" TEXT NOT NULL,
  "tid" TEXT,
  "status" "RfidTagStatus" NOT NULL DEFAULT 'ACTIVE',
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "RfidTag_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "HoldUnitTagBinding" (
  "id" TEXT NOT NULL,
  "holdUnitId" TEXT NOT NULL,
  "rfidTagId" TEXT NOT NULL,
  "boundByAccountId" TEXT NOT NULL,
  "boundAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "unboundAt" TIMESTAMP(3),
  "unbindReason" TEXT,
  CONSTRAINT "HoldUnitTagBinding_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "HoldUnitEvent" (
  "id" TEXT NOT NULL,
  "organizationId" TEXT NOT NULL,
  "holdUnitId" TEXT NOT NULL,
  "type" "HoldUnitEventType" NOT NULL,
  "actorAccountId" TEXT NOT NULL,
  "requestKey" TEXT,
  "fromCustodianOrganizationId" TEXT,
  "toCustodianOrganizationId" TEXT,
  "fromFacilityId" TEXT,
  "toFacilityId" TEXT,
  "metadata" JSONB,
  "occurredAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "recordedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "HoldUnitEvent_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "Facility_organizationId_code_key" ON "Facility"("organizationId", "code");
CREATE UNIQUE INDEX "Facility_one_default_per_organization" ON "Facility"("organizationId") WHERE "isDefault" = true;
CREATE INDEX "Facility_organizationId_status_idx" ON "Facility"("organizationId", "status");

CREATE UNIQUE INDEX "HoldUnitRegistrationBatch_organizationId_requestKey_key"
  ON "HoldUnitRegistrationBatch"("organizationId", "requestKey");
CREATE INDEX "HoldUnitRegistrationBatch_holdVariantId_createdAt_idx"
  ON "HoldUnitRegistrationBatch"("holdVariantId", "createdAt");
CREATE INDEX "HoldUnitRegistrationBatch_facilityId_createdAt_idx"
  ON "HoldUnitRegistrationBatch"("facilityId", "createdAt");

CREATE UNIQUE INDEX "HoldUnit_assetCode_key" ON "HoldUnit"("assetCode");
CREATE INDEX "HoldUnit_holdVariantId_physicalStatus_operationalStatus_idx"
  ON "HoldUnit"("holdVariantId", "physicalStatus", "operationalStatus");
CREATE INDEX "HoldUnit_ownerOrganizationId_physicalStatus_idx"
  ON "HoldUnit"("ownerOrganizationId", "physicalStatus");
CREATE INDEX "HoldUnit_currentCustodianOrganizationId_currentFacilityId_physicalStatus_idx"
  ON "HoldUnit"("currentCustodianOrganizationId", "currentFacilityId", "physicalStatus");
CREATE INDEX "HoldUnit_registrationBatchId_idx" ON "HoldUnit"("registrationBatchId");

CREATE UNIQUE INDEX "RfidTag_epc_key" ON "RfidTag"("epc");
CREATE UNIQUE INDEX "RfidTag_tid_key" ON "RfidTag"("tid");
CREATE INDEX "RfidTag_organizationId_status_idx" ON "RfidTag"("organizationId", "status");

CREATE UNIQUE INDEX "HoldUnitTagBinding_one_active_tag_per_unit"
  ON "HoldUnitTagBinding"("holdUnitId") WHERE "unboundAt" IS NULL;
CREATE UNIQUE INDEX "HoldUnitTagBinding_one_active_unit_per_tag"
  ON "HoldUnitTagBinding"("rfidTagId") WHERE "unboundAt" IS NULL;
CREATE INDEX "HoldUnitTagBinding_holdUnitId_unboundAt_idx"
  ON "HoldUnitTagBinding"("holdUnitId", "unboundAt");
CREATE INDEX "HoldUnitTagBinding_rfidTagId_unboundAt_idx"
  ON "HoldUnitTagBinding"("rfidTagId", "unboundAt");

CREATE UNIQUE INDEX "HoldUnitEvent_organizationId_requestKey_key"
  ON "HoldUnitEvent"("organizationId", "requestKey");
CREATE INDEX "HoldUnitEvent_holdUnitId_occurredAt_idx"
  ON "HoldUnitEvent"("holdUnitId", "occurredAt");
CREATE INDEX "HoldUnitEvent_organizationId_occurredAt_idx"
  ON "HoldUnitEvent"("organizationId", "occurredAt");

ALTER TABLE "Facility" ADD CONSTRAINT "Facility_organizationId_fkey"
  FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "HoldUnitRegistrationBatch" ADD CONSTRAINT "HoldUnitRegistrationBatch_organizationId_fkey"
  FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "HoldUnitRegistrationBatch" ADD CONSTRAINT "HoldUnitRegistrationBatch_holdVariantId_fkey"
  FOREIGN KEY ("holdVariantId") REFERENCES "HoldVariant"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "HoldUnitRegistrationBatch" ADD CONSTRAINT "HoldUnitRegistrationBatch_facilityId_fkey"
  FOREIGN KEY ("facilityId") REFERENCES "Facility"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "HoldUnitRegistrationBatch" ADD CONSTRAINT "HoldUnitRegistrationBatch_createdByAccountId_fkey"
  FOREIGN KEY ("createdByAccountId") REFERENCES "Account"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "HoldUnit" ADD CONSTRAINT "HoldUnit_holdVariantId_fkey"
  FOREIGN KEY ("holdVariantId") REFERENCES "HoldVariant"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "HoldUnit" ADD CONSTRAINT "HoldUnit_ownerOrganizationId_fkey"
  FOREIGN KEY ("ownerOrganizationId") REFERENCES "Organization"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "HoldUnit" ADD CONSTRAINT "HoldUnit_currentCustodianOrganizationId_fkey"
  FOREIGN KEY ("currentCustodianOrganizationId") REFERENCES "Organization"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "HoldUnit" ADD CONSTRAINT "HoldUnit_currentFacilityId_fkey"
  FOREIGN KEY ("currentFacilityId") REFERENCES "Facility"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "HoldUnit" ADD CONSTRAINT "HoldUnit_registrationBatchId_fkey"
  FOREIGN KEY ("registrationBatchId") REFERENCES "HoldUnitRegistrationBatch"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "HoldUnit" ADD CONSTRAINT "HoldUnit_registeredByAccountId_fkey"
  FOREIGN KEY ("registeredByAccountId") REFERENCES "Account"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "RfidTag" ADD CONSTRAINT "RfidTag_organizationId_fkey"
  FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "HoldUnitTagBinding" ADD CONSTRAINT "HoldUnitTagBinding_holdUnitId_fkey"
  FOREIGN KEY ("holdUnitId") REFERENCES "HoldUnit"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "HoldUnitTagBinding" ADD CONSTRAINT "HoldUnitTagBinding_rfidTagId_fkey"
  FOREIGN KEY ("rfidTagId") REFERENCES "RfidTag"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "HoldUnitTagBinding" ADD CONSTRAINT "HoldUnitTagBinding_boundByAccountId_fkey"
  FOREIGN KEY ("boundByAccountId") REFERENCES "Account"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "HoldUnitEvent" ADD CONSTRAINT "HoldUnitEvent_organizationId_fkey"
  FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "HoldUnitEvent" ADD CONSTRAINT "HoldUnitEvent_holdUnitId_fkey"
  FOREIGN KEY ("holdUnitId") REFERENCES "HoldUnit"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "HoldUnitEvent" ADD CONSTRAINT "HoldUnitEvent_actorAccountId_fkey"
  FOREIGN KEY ("actorAccountId") REFERENCES "Account"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- Every existing tenant starts with one physical site. This keeps the migration non-interactive.
INSERT INTO "Facility" ("id", "organizationId", "code", "name", "status", "isDefault", "createdAt", "updatedAt")
SELECT 'facility_default_' || "id", "id", 'DEFAULT', "name", 'ACTIVE', true, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP
FROM "Organization";

-- Cross-table tenant invariants cannot be expressed by Prisma relations alone.
CREATE OR REPLACE FUNCTION "assert_hold_unit_scope"() RETURNS trigger AS $$
BEGIN
  IF TG_TABLE_NAME = 'HoldUnitRegistrationBatch' THEN
    IF NOT EXISTS (
      SELECT 1 FROM "HoldVariant" variant
      JOIN "HoldModel" model ON model."id" = variant."holdModelId"
      JOIN "Facility" facility ON facility."id" = NEW."facilityId"
      WHERE variant."id" = NEW."holdVariantId"
        AND model."organizationId" = NEW."organizationId"
        AND facility."organizationId" = NEW."organizationId"
    ) THEN RAISE EXCEPTION USING ERRCODE = '23514', MESSAGE = 'HoldUnitRegistrationBatch scope mismatch'; END IF;

  ELSIF TG_TABLE_NAME = 'HoldUnit' THEN
    IF NOT EXISTS (
      SELECT 1 FROM "HoldVariant" variant
      JOIN "HoldModel" model ON model."id" = variant."holdModelId"
      JOIN "Facility" facility ON facility."id" = NEW."currentFacilityId"
      JOIN "HoldUnitRegistrationBatch" batch ON batch."id" = NEW."registrationBatchId"
      WHERE variant."id" = NEW."holdVariantId"
        AND model."organizationId" = NEW."ownerOrganizationId"
        AND facility."organizationId" = NEW."currentCustodianOrganizationId"
        AND batch."organizationId" = NEW."ownerOrganizationId"
        AND batch."holdVariantId" = NEW."holdVariantId"
        AND batch."facilityId" = NEW."currentFacilityId"
    ) THEN RAISE EXCEPTION USING ERRCODE = '23514', MESSAGE = 'HoldUnit scope mismatch'; END IF;

  ELSIF TG_TABLE_NAME = 'HoldUnitTagBinding' THEN
    IF NOT EXISTS (
      SELECT 1 FROM "HoldUnit" unit
      JOIN "RfidTag" tag ON tag."id" = NEW."rfidTagId"
      WHERE unit."id" = NEW."holdUnitId" AND tag."organizationId" = unit."ownerOrganizationId"
    ) THEN RAISE EXCEPTION USING ERRCODE = '23514', MESSAGE = 'HoldUnitTagBinding scope mismatch'; END IF;

  ELSIF TG_TABLE_NAME = 'HoldUnitEvent' THEN
    IF NOT EXISTS (
      SELECT 1 FROM "HoldUnit" unit
      WHERE unit."id" = NEW."holdUnitId" AND unit."ownerOrganizationId" = NEW."organizationId"
    ) THEN RAISE EXCEPTION USING ERRCODE = '23514', MESSAGE = 'HoldUnitEvent scope mismatch'; END IF;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER "HoldUnitRegistrationBatch_scope_guard"
  BEFORE INSERT OR UPDATE ON "HoldUnitRegistrationBatch"
  FOR EACH ROW EXECUTE FUNCTION "assert_hold_unit_scope"();
CREATE TRIGGER "HoldUnit_scope_guard"
  BEFORE INSERT OR UPDATE ON "HoldUnit"
  FOR EACH ROW EXECUTE FUNCTION "assert_hold_unit_scope"();
CREATE TRIGGER "HoldUnitTagBinding_scope_guard"
  BEFORE INSERT OR UPDATE ON "HoldUnitTagBinding"
  FOR EACH ROW EXECUTE FUNCTION "assert_hold_unit_scope"();
CREATE TRIGGER "HoldUnitEvent_scope_guard"
  BEFORE INSERT OR UPDATE ON "HoldUnitEvent"
  FOR EACH ROW EXECUTE FUNCTION "assert_hold_unit_scope"();
