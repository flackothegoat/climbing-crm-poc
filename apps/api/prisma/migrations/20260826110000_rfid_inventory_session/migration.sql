CREATE TYPE "RfidInventorySessionStatus" AS ENUM ('OPEN', 'COMPLETED', 'CANCELLED');
CREATE TYPE "RfidInventoryMatchStatus" AS ENUM (
  'MATCHED_EXPECTED', 'MATCHED_UNEXPECTED', 'UNBOUND', 'UNKNOWN'
);

CREATE TABLE "RfidInventorySession" (
  "id" TEXT NOT NULL,
  "organizationId" TEXT NOT NULL,
  "facilityId" TEXT NOT NULL,
  "requestKey" TEXT NOT NULL,
  "name" TEXT NOT NULL,
  "targetPhysicalStatus" "HoldUnitPhysicalStatus" NOT NULL,
  "status" "RfidInventorySessionStatus" NOT NULL DEFAULT 'OPEN',
  "version" INTEGER NOT NULL DEFAULT 0,
  "createdByAccountId" TEXT NOT NULL,
  "completedByAccountId" TEXT,
  "completedAt" TIMESTAMP(3),
  "cancelledAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "RfidInventorySession_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "RfidInventorySession_target_check"
    CHECK ("targetPhysicalStatus" IN ('WAREHOUSE', 'INSTALLED')),
  CONSTRAINT "RfidInventorySession_state_check" CHECK (
    ("status" = 'OPEN' AND "completedByAccountId" IS NULL AND "completedAt" IS NULL AND "cancelledAt" IS NULL)
    OR ("status" = 'COMPLETED' AND "completedByAccountId" IS NOT NULL AND "completedAt" IS NOT NULL AND "cancelledAt" IS NULL)
    OR ("status" = 'CANCELLED' AND "completedByAccountId" IS NULL AND "completedAt" IS NULL AND "cancelledAt" IS NOT NULL)
  )
);

CREATE TABLE "RfidInventoryObservation" (
  "id" TEXT NOT NULL,
  "sessionId" TEXT NOT NULL,
  "epc" TEXT NOT NULL,
  "matchStatus" "RfidInventoryMatchStatus" NOT NULL,
  "rfidTagId" TEXT,
  "holdUnitId" TEXT,
  "readCount" INTEGER NOT NULL DEFAULT 1,
  "firstSeenAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "lastSeenAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "RfidInventoryObservation_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "RfidInventoryObservation_read_count_check" CHECK ("readCount" > 0),
  CONSTRAINT "RfidInventoryObservation_time_check" CHECK ("lastSeenAt" >= "firstSeenAt"),
  CONSTRAINT "RfidInventoryObservation_match_shape_check" CHECK (
    ("matchStatus" IN ('MATCHED_EXPECTED', 'MATCHED_UNEXPECTED') AND "rfidTagId" IS NOT NULL AND "holdUnitId" IS NOT NULL)
    OR ("matchStatus" = 'UNBOUND' AND "rfidTagId" IS NOT NULL AND "holdUnitId" IS NULL)
    OR ("matchStatus" = 'UNKNOWN' AND "rfidTagId" IS NULL AND "holdUnitId" IS NULL)
  )
);

CREATE TABLE "RfidInventoryExpectedUnit" (
  "id" TEXT NOT NULL,
  "sessionId" TEXT NOT NULL,
  "holdUnitId" TEXT NOT NULL,
  "rfidTagId" TEXT NOT NULL,
  "epc" TEXT NOT NULL,
  CONSTRAINT "RfidInventoryExpectedUnit_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "RfidInventoryReadBatch" (
  "id" TEXT NOT NULL,
  "organizationId" TEXT NOT NULL,
  "sessionId" TEXT NOT NULL,
  "requestKey" TEXT NOT NULL,
  "requestFingerprint" TEXT NOT NULL,
  "submittedCount" INTEGER NOT NULL,
  "uniqueCount" INTEGER NOT NULL,
  "createdByAccountId" TEXT NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "RfidInventoryReadBatch_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "RfidInventoryReadBatch_count_check"
    CHECK ("submittedCount" > 0 AND "uniqueCount" > 0 AND "uniqueCount" <= "submittedCount")
);

CREATE UNIQUE INDEX "RfidInventorySession_organizationId_requestKey_key"
  ON "RfidInventorySession"("organizationId", "requestKey");
CREATE UNIQUE INDEX "RfidInventorySession_one_open_scope"
  ON "RfidInventorySession"("facilityId", "targetPhysicalStatus") WHERE "status" = 'OPEN';
CREATE INDEX "RfidInventorySession_organizationId_status_createdAt_idx"
  ON "RfidInventorySession"("organizationId", "status", "createdAt");
CREATE INDEX "RfidInventorySession_facilityId_targetPhysicalStatus_status_idx"
  ON "RfidInventorySession"("facilityId", "targetPhysicalStatus", "status");

CREATE UNIQUE INDEX "RfidInventoryObservation_sessionId_epc_key"
  ON "RfidInventoryObservation"("sessionId", "epc");
CREATE INDEX "RfidInventoryObservation_sessionId_matchStatus_idx"
  ON "RfidInventoryObservation"("sessionId", "matchStatus");
CREATE INDEX "RfidInventoryObservation_holdUnitId_idx"
  ON "RfidInventoryObservation"("holdUnitId");

CREATE UNIQUE INDEX "RfidInventoryExpectedUnit_sessionId_holdUnitId_key"
  ON "RfidInventoryExpectedUnit"("sessionId", "holdUnitId");
CREATE UNIQUE INDEX "RfidInventoryExpectedUnit_sessionId_rfidTagId_key"
  ON "RfidInventoryExpectedUnit"("sessionId", "rfidTagId");
CREATE UNIQUE INDEX "RfidInventoryExpectedUnit_sessionId_epc_key"
  ON "RfidInventoryExpectedUnit"("sessionId", "epc");
CREATE INDEX "RfidInventoryExpectedUnit_holdUnitId_idx"
  ON "RfidInventoryExpectedUnit"("holdUnitId");

CREATE UNIQUE INDEX "RfidInventoryReadBatch_organizationId_requestKey_key"
  ON "RfidInventoryReadBatch"("organizationId", "requestKey");
CREATE INDEX "RfidInventoryReadBatch_sessionId_createdAt_idx"
  ON "RfidInventoryReadBatch"("sessionId", "createdAt");

ALTER TABLE "RfidInventorySession" ADD CONSTRAINT "RfidInventorySession_organizationId_fkey"
  FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "RfidInventorySession" ADD CONSTRAINT "RfidInventorySession_facilityId_fkey"
  FOREIGN KEY ("facilityId") REFERENCES "Facility"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "RfidInventorySession" ADD CONSTRAINT "RfidInventorySession_createdByAccountId_fkey"
  FOREIGN KEY ("createdByAccountId") REFERENCES "Account"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "RfidInventorySession" ADD CONSTRAINT "RfidInventorySession_completedByAccountId_fkey"
  FOREIGN KEY ("completedByAccountId") REFERENCES "Account"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "RfidInventoryObservation" ADD CONSTRAINT "RfidInventoryObservation_sessionId_fkey"
  FOREIGN KEY ("sessionId") REFERENCES "RfidInventorySession"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "RfidInventoryObservation" ADD CONSTRAINT "RfidInventoryObservation_rfidTagId_fkey"
  FOREIGN KEY ("rfidTagId") REFERENCES "RfidTag"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "RfidInventoryObservation" ADD CONSTRAINT "RfidInventoryObservation_holdUnitId_fkey"
  FOREIGN KEY ("holdUnitId") REFERENCES "HoldUnit"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "RfidInventoryExpectedUnit" ADD CONSTRAINT "RfidInventoryExpectedUnit_sessionId_fkey"
  FOREIGN KEY ("sessionId") REFERENCES "RfidInventorySession"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "RfidInventoryExpectedUnit" ADD CONSTRAINT "RfidInventoryExpectedUnit_holdUnitId_fkey"
  FOREIGN KEY ("holdUnitId") REFERENCES "HoldUnit"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "RfidInventoryExpectedUnit" ADD CONSTRAINT "RfidInventoryExpectedUnit_rfidTagId_fkey"
  FOREIGN KEY ("rfidTagId") REFERENCES "RfidTag"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "RfidInventoryReadBatch" ADD CONSTRAINT "RfidInventoryReadBatch_organizationId_fkey"
  FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "RfidInventoryReadBatch" ADD CONSTRAINT "RfidInventoryReadBatch_sessionId_fkey"
  FOREIGN KEY ("sessionId") REFERENCES "RfidInventorySession"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "RfidInventoryReadBatch" ADD CONSTRAINT "RfidInventoryReadBatch_createdByAccountId_fkey"
  FOREIGN KEY ("createdByAccountId") REFERENCES "Account"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

CREATE OR REPLACE FUNCTION "assert_rfid_inventory_scope"() RETURNS trigger AS $$
DECLARE
  session_org TEXT;
BEGIN
  IF TG_TABLE_NAME = 'RfidInventorySession' THEN
    IF NOT EXISTS (
      SELECT 1 FROM "Facility" facility
      WHERE facility."id" = NEW."facilityId"
        AND facility."organizationId" = NEW."organizationId"
    ) THEN RAISE EXCEPTION USING ERRCODE = '23514', MESSAGE = 'RfidInventorySession scope mismatch'; END IF;

  ELSIF TG_TABLE_NAME = 'RfidInventoryReadBatch' THEN
    IF NOT EXISTS (
      SELECT 1 FROM "RfidInventorySession" session
      WHERE session."id" = NEW."sessionId"
        AND session."organizationId" = NEW."organizationId"
    ) THEN RAISE EXCEPTION USING ERRCODE = '23514', MESSAGE = 'RfidInventoryReadBatch scope mismatch'; END IF;

  ELSIF TG_TABLE_NAME = 'RfidInventoryObservation' THEN
    SELECT session."organizationId" INTO session_org
    FROM "RfidInventorySession" session WHERE session."id" = NEW."sessionId";

    IF NEW."matchStatus" IN ('MATCHED_EXPECTED', 'MATCHED_UNEXPECTED') AND NOT EXISTS (
      SELECT 1 FROM "RfidTag" tag
      JOIN "HoldUnitTagBinding" binding ON binding."rfidTagId" = tag."id" AND binding."unboundAt" IS NULL
      JOIN "HoldUnit" unit ON unit."id" = binding."holdUnitId"
      WHERE tag."id" = NEW."rfidTagId"
        AND tag."epc" = NEW."epc"
        AND unit."id" = NEW."holdUnitId"
        AND (unit."ownerOrganizationId" = session_org OR unit."currentCustodianOrganizationId" = session_org)
    ) THEN RAISE EXCEPTION USING ERRCODE = '23514', MESSAGE = 'RfidInventoryObservation match scope mismatch'; END IF;

    IF NEW."matchStatus" = 'UNBOUND' AND NOT EXISTS (
      SELECT 1 FROM "RfidTag" tag
      WHERE tag."id" = NEW."rfidTagId"
        AND tag."epc" = NEW."epc"
        AND tag."organizationId" = session_org
    ) THEN RAISE EXCEPTION USING ERRCODE = '23514', MESSAGE = 'RfidInventoryObservation tag scope mismatch'; END IF;

  ELSIF TG_TABLE_NAME = 'RfidInventoryExpectedUnit' THEN
    IF NOT EXISTS (
      SELECT 1 FROM "RfidInventorySession" session
      JOIN "HoldUnit" unit ON unit."id" = NEW."holdUnitId"
      JOIN "HoldUnitTagBinding" binding ON binding."holdUnitId" = unit."id" AND binding."unboundAt" IS NULL
      JOIN "RfidTag" tag ON tag."id" = binding."rfidTagId"
      WHERE session."id" = NEW."sessionId"
        AND tag."id" = NEW."rfidTagId"
        AND tag."epc" = NEW."epc"
        AND tag."status" = 'ACTIVE'
        AND unit."currentCustodianOrganizationId" = session."organizationId"
        AND unit."currentFacilityId" = session."facilityId"
        AND unit."physicalStatus" = session."targetPhysicalStatus"
        AND unit."operationalStatus" = 'ACTIVE'
    ) THEN RAISE EXCEPTION USING ERRCODE = '23514', MESSAGE = 'RfidInventoryExpectedUnit scope mismatch'; END IF;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER "RfidInventorySession_scope_guard"
  BEFORE INSERT OR UPDATE ON "RfidInventorySession"
  FOR EACH ROW EXECUTE FUNCTION "assert_rfid_inventory_scope"();
CREATE TRIGGER "RfidInventoryObservation_scope_guard"
  BEFORE INSERT OR UPDATE ON "RfidInventoryObservation"
  FOR EACH ROW EXECUTE FUNCTION "assert_rfid_inventory_scope"();
CREATE TRIGGER "RfidInventoryExpectedUnit_scope_guard"
  BEFORE INSERT OR UPDATE ON "RfidInventoryExpectedUnit"
  FOR EACH ROW EXECUTE FUNCTION "assert_rfid_inventory_scope"();
CREATE TRIGGER "RfidInventoryReadBatch_scope_guard"
  BEFORE INSERT OR UPDATE ON "RfidInventoryReadBatch"
  FOR EACH ROW EXECUTE FUNCTION "assert_rfid_inventory_scope"();
