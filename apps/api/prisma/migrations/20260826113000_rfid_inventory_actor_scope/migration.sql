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

    IF NOT EXISTS (
      SELECT 1 FROM "Membership" membership
      WHERE membership."accountId" = NEW."createdByAccountId"
        AND membership."organizationId" = NEW."organizationId"
    ) THEN RAISE EXCEPTION USING ERRCODE = '23514', MESSAGE = 'RfidInventorySession creator scope mismatch'; END IF;

    IF NEW."completedByAccountId" IS NOT NULL AND NOT EXISTS (
      SELECT 1 FROM "Membership" membership
      WHERE membership."accountId" = NEW."completedByAccountId"
        AND membership."organizationId" = NEW."organizationId"
    ) THEN RAISE EXCEPTION USING ERRCODE = '23514', MESSAGE = 'RfidInventorySession completer scope mismatch'; END IF;

  ELSIF TG_TABLE_NAME = 'RfidInventoryReadBatch' THEN
    IF NOT EXISTS (
      SELECT 1 FROM "RfidInventorySession" session
      WHERE session."id" = NEW."sessionId"
        AND session."organizationId" = NEW."organizationId"
    ) THEN RAISE EXCEPTION USING ERRCODE = '23514', MESSAGE = 'RfidInventoryReadBatch scope mismatch'; END IF;

    IF NOT EXISTS (
      SELECT 1 FROM "Membership" membership
      WHERE membership."accountId" = NEW."createdByAccountId"
        AND membership."organizationId" = NEW."organizationId"
    ) THEN RAISE EXCEPTION USING ERRCODE = '23514', MESSAGE = 'RfidInventoryReadBatch creator scope mismatch'; END IF;

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
