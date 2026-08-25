-- A unit's registration facility is immutable history; its current facility may change later.
-- Keep tenant and variant consistency without pinning the current location to the first batch.
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
