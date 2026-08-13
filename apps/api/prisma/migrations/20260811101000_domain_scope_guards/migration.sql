-- Prisma cannot express every transitive tenant/geometry invariant in this model.
-- These database triggers are the final safety boundary for imports, scripts and future code paths.

CREATE OR REPLACE FUNCTION "assert_domain_scope"() RETURNS trigger AS $$
BEGIN
  IF TG_TABLE_NAME = 'WallSegment' THEN
    IF NOT EXISTS (
      SELECT 1 FROM "WallArea" area
      WHERE area."id" = NEW."areaId" AND area."organizationId" = NEW."organizationId"
    ) THEN RAISE EXCEPTION USING ERRCODE = '23514', MESSAGE = 'WallSegment area/organization mismatch'; END IF;

  ELSIF TG_TABLE_NAME = 'WallGeometryVersion' THEN
    IF NOT EXISTS (
      SELECT 1 FROM "WallSegment" segment
      WHERE segment."id" = NEW."wallSegmentId" AND segment."organizationId" = NEW."organizationId"
    ) THEN RAISE EXCEPTION USING ERRCODE = '23514', MESSAGE = 'WallGeometryVersion segment/organization mismatch'; END IF;

  ELSIF TG_TABLE_NAME = 'WallHole' THEN
    IF NOT EXISTS (
      SELECT 1 FROM "WallGeometryVersion" geometry
      WHERE geometry."id" = NEW."geometryVersionId"
        AND geometry."wallSegmentId" = NEW."wallSegmentId"
        AND geometry."organizationId" = NEW."organizationId"
    ) THEN RAISE EXCEPTION USING ERRCODE = '23514', MESSAGE = 'WallHole geometry/segment/organization mismatch'; END IF;

  ELSIF TG_TABLE_NAME = 'WallSegmentAdjacency' THEN
    IF NOT EXISTS (
      SELECT 1
      FROM "WallArea" area
      JOIN "WallSegment" a ON a."id" = NEW."segmentAId"
      JOIN "WallSegment" b ON b."id" = NEW."segmentBId"
      WHERE area."id" = NEW."areaId"
        AND area."organizationId" = NEW."organizationId"
        AND a."organizationId" = NEW."organizationId" AND a."areaId" = NEW."areaId"
        AND b."organizationId" = NEW."organizationId" AND b."areaId" = NEW."areaId"
    ) THEN RAISE EXCEPTION USING ERRCODE = '23514', MESSAGE = 'WallSegmentAdjacency scope mismatch'; END IF;

  ELSIF TG_TABLE_NAME = 'HoldModel' THEN
    IF NOT EXISTS (
      SELECT 1 FROM "HoldCategory" category
      WHERE category."id" = NEW."categoryId" AND category."organizationId" = NEW."organizationId"
    ) THEN RAISE EXCEPTION USING ERRCODE = '23514', MESSAGE = 'HoldModel category/organization mismatch'; END IF;

  ELSIF TG_TABLE_NAME = 'HoldInventoryMovement' THEN
    IF NOT EXISTS (
      SELECT 1 FROM "HoldVariant" variant
      JOIN "HoldModel" model ON model."id" = variant."holdModelId"
      WHERE variant."id" = NEW."variantId" AND model."organizationId" = NEW."organizationId"
    ) THEN RAISE EXCEPTION USING ERRCODE = '23514', MESSAGE = 'HoldInventoryMovement variant/organization mismatch'; END IF;

  ELSIF TG_TABLE_NAME = 'HoldScan' THEN
    IF NOT EXISTS (
      SELECT 1 FROM "HoldCategory" category
      WHERE category."id" = NEW."categoryId" AND category."organizationId" = NEW."organizationId"
    ) OR (NEW."specificationId" IS NOT NULL AND NOT EXISTS (
      SELECT 1 FROM "HoldVariant" variant
      JOIN "HoldModel" model ON model."id" = variant."holdModelId"
      WHERE variant."id" = NEW."specificationId" AND model."organizationId" = NEW."organizationId"
    )) OR (NEW."initializationBatchId" IS NOT NULL AND NOT EXISTS (
      SELECT 1 FROM "HoldInitializationBatch" batch
      WHERE batch."id" = NEW."initializationBatchId" AND batch."organizationId" = NEW."organizationId"
    )) THEN RAISE EXCEPTION USING ERRCODE = '23514', MESSAGE = 'HoldScan organization scope mismatch'; END IF;

  ELSIF TG_TABLE_NAME = 'HoldAsset' THEN
    IF NOT EXISTS (
      SELECT 1 FROM "HoldScan" scan
      WHERE scan."id" = NEW."scanId" AND scan."organizationId" = NEW."organizationId"
    ) OR (NEW."specificationId" IS NOT NULL AND NOT EXISTS (
      SELECT 1 FROM "HoldVariant" variant
      JOIN "HoldModel" model ON model."id" = variant."holdModelId"
      WHERE variant."id" = NEW."specificationId" AND model."organizationId" = NEW."organizationId"
    )) THEN RAISE EXCEPTION USING ERRCODE = '23514', MESSAGE = 'HoldAsset organization scope mismatch'; END IF;

  ELSIF TG_TABLE_NAME = 'HoldInitializationEntry' THEN
    IF NOT EXISTS (
      SELECT 1 FROM "HoldInitializationBatch" batch
      JOIN "HoldVariant" variant ON variant."id" = NEW."specificationId"
      JOIN "HoldModel" model ON model."id" = variant."holdModelId"
      WHERE batch."id" = NEW."batchId" AND batch."organizationId" = model."organizationId"
        AND (NEW."scanId" IS NULL OR EXISTS (
          SELECT 1 FROM "HoldScan" scan
          WHERE scan."id" = NEW."scanId" AND scan."organizationId" = batch."organizationId"
        ))
    ) THEN RAISE EXCEPTION USING ERRCODE = '23514', MESSAGE = 'HoldInitializationEntry organization scope mismatch'; END IF;

  ELSIF TG_TABLE_NAME = 'RouteVersion' THEN
    IF NOT EXISTS (
      SELECT 1 FROM "Route" route
      WHERE route."id" = NEW."routeId" AND route."organizationId" = NEW."organizationId"
    ) OR (NEW."settingJobId" IS NOT NULL AND NOT EXISTS (
      SELECT 1 FROM "WallSettingJob" job
      WHERE job."id" = NEW."settingJobId" AND job."organizationId" = NEW."organizationId"
    )) THEN RAISE EXCEPTION USING ERRCODE = '23514', MESSAGE = 'RouteVersion organization scope mismatch'; END IF;

  ELSIF TG_TABLE_NAME = 'RouteVersionWallSegment' THEN
    IF NOT EXISTS (
      SELECT 1
      FROM "RouteVersion" version
      JOIN "WallSegment" segment ON segment."id" = NEW."wallSegmentId"
      JOIN "WallGeometryVersion" geometry ON geometry."id" = NEW."geometryVersionId"
      WHERE version."id" = NEW."routeVersionId" AND version."organizationId" = NEW."organizationId"
        AND segment."organizationId" = NEW."organizationId"
        AND geometry."organizationId" = NEW."organizationId"
        AND geometry."wallSegmentId" = NEW."wallSegmentId"
    ) THEN RAISE EXCEPTION USING ERRCODE = '23514', MESSAGE = 'RouteVersionWallSegment scope mismatch'; END IF;

  ELSIF TG_TABLE_NAME = 'RouteHoldPlacement' THEN
    IF NOT EXISTS (
      SELECT 1
      FROM "RouteVersion" version
      JOIN "WallHole" hole ON hole."id" = NEW."wallHoleId"
      JOIN "RouteVersionWallSegment" scope
        ON scope."routeVersionId" = version."id"
       AND scope."wallSegmentId" = hole."wallSegmentId"
       AND scope."geometryVersionId" = hole."geometryVersionId"
      WHERE version."id" = NEW."routeVersionId" AND version."organizationId" = NEW."organizationId"
        AND hole."organizationId" = NEW."organizationId"
    ) OR (NEW."holdVariantId" IS NOT NULL AND NOT EXISTS (
      SELECT 1 FROM "HoldVariant" variant
      JOIN "HoldModel" model ON model."id" = variant."holdModelId"
      WHERE variant."id" = NEW."holdVariantId" AND model."organizationId" = NEW."organizationId"
    )) THEN RAISE EXCEPTION USING ERRCODE = '23514', MESSAGE = 'RouteHoldPlacement scope mismatch'; END IF;

  ELSIF TG_TABLE_NAME = 'RouteHoldPlacementAnchor' THEN
    IF NOT EXISTS (
      SELECT 1
      FROM "RouteHoldPlacement" placement
      JOIN "WallHole" hole ON hole."id" = NEW."wallHoleId"
      JOIN "RouteVersionWallSegment" scope
        ON scope."routeVersionId" = placement."routeVersionId"
       AND scope."wallSegmentId" = hole."wallSegmentId"
       AND scope."geometryVersionId" = hole."geometryVersionId"
      WHERE placement."id" = NEW."placementId"
        AND placement."organizationId" = NEW."organizationId"
        AND hole."organizationId" = NEW."organizationId"
    ) THEN RAISE EXCEPTION USING ERRCODE = '23514', MESSAGE = 'RouteHoldPlacementAnchor scope mismatch'; END IF;

  ELSIF TG_TABLE_NAME = 'WallAsset' THEN
    IF NOT EXISTS (
      SELECT 1 FROM "WallGeometryVersion" geometry
      WHERE geometry."id" = NEW."geometryVersionId" AND geometry."organizationId" = NEW."organizationId"
    ) THEN RAISE EXCEPTION USING ERRCODE = '23514', MESSAGE = 'WallAsset geometry/organization mismatch'; END IF;

  ELSIF TG_TABLE_NAME = 'WallCapture' THEN
    IF NEW."settingJobId" IS NOT NULL AND NOT EXISTS (
      SELECT 1 FROM "WallSettingJob" job
      WHERE job."id" = NEW."settingJobId" AND job."organizationId" = NEW."organizationId"
    ) THEN RAISE EXCEPTION USING ERRCODE = '23514', MESSAGE = 'WallCapture job/organization mismatch'; END IF;

  ELSIF TG_TABLE_NAME = 'WallCaptureSegment' THEN
    IF NOT EXISTS (
      SELECT 1 FROM "WallCapture" capture
      JOIN "WallSegment" segment ON segment."id" = NEW."wallSegmentId"
      WHERE capture."id" = NEW."captureId" AND capture."organizationId" = segment."organizationId"
        AND (NEW."geometryVersionId" IS NULL OR EXISTS (
          SELECT 1 FROM "WallGeometryVersion" geometry
          WHERE geometry."id" = NEW."geometryVersionId"
            AND geometry."wallSegmentId" = NEW."wallSegmentId"
            AND geometry."organizationId" = capture."organizationId"
        ))
    ) THEN RAISE EXCEPTION USING ERRCODE = '23514', MESSAGE = 'WallCaptureSegment scope mismatch'; END IF;

  ELSIF TG_TABLE_NAME = 'WallObservedHold' THEN
    IF NOT EXISTS (
      SELECT 1 FROM "WallCapture" capture
      WHERE capture."id" = NEW."captureId" AND capture."organizationId" = NEW."organizationId"
    ) OR (NEW."matchedVariantId" IS NOT NULL AND NOT EXISTS (
      SELECT 1 FROM "HoldVariant" variant
      JOIN "HoldModel" model ON model."id" = variant."holdModelId"
      WHERE variant."id" = NEW."matchedVariantId" AND model."organizationId" = NEW."organizationId"
    )) THEN RAISE EXCEPTION USING ERRCODE = '23514', MESSAGE = 'WallObservedHold scope mismatch'; END IF;

  ELSIF TG_TABLE_NAME = 'WallObservedHoldAnchor' THEN
    IF NOT EXISTS (
      SELECT 1 FROM "WallObservedHold" observed
      JOIN "WallCaptureSegment" capture_segment ON capture_segment."captureId" = observed."captureId"
      JOIN "WallHole" hole ON hole."id" = NEW."wallHoleId"
      WHERE observed."id" = NEW."observedHoldId"
        AND hole."organizationId" = observed."organizationId"
        AND hole."wallSegmentId" = capture_segment."wallSegmentId"
        AND (capture_segment."geometryVersionId" IS NULL OR hole."geometryVersionId" = capture_segment."geometryVersionId")
    ) THEN RAISE EXCEPTION USING ERRCODE = '23514', MESSAGE = 'WallObservedHoldAnchor scope mismatch'; END IF;

  ELSIF TG_TABLE_NAME = 'WallSettingJobSegment' THEN
    IF NOT EXISTS (
      SELECT 1 FROM "WallSettingJob" job
      JOIN "WallSegment" segment ON segment."id" = NEW."wallSegmentId"
      JOIN "WallGeometryVersion" geometry ON geometry."id" = NEW."geometryVersionId"
      WHERE job."id" = NEW."settingJobId"
        AND segment."organizationId" = job."organizationId"
        AND geometry."organizationId" = job."organizationId"
        AND geometry."wallSegmentId" = NEW."wallSegmentId"
    ) THEN RAISE EXCEPTION USING ERRCODE = '23514', MESSAGE = 'WallSettingJobSegment scope mismatch'; END IF;

  ELSIF TG_TABLE_NAME = 'HoldInstallation' THEN
    IF NOT EXISTS (
      SELECT 1 FROM "HoldVariant" variant
      JOIN "HoldModel" model ON model."id" = variant."holdModelId"
      WHERE variant."id" = NEW."holdVariantId" AND model."organizationId" = NEW."organizationId"
    ) OR (NEW."routeVersionId" IS NOT NULL AND NOT EXISTS (
      SELECT 1 FROM "RouteVersion" version
      WHERE version."id" = NEW."routeVersionId" AND version."organizationId" = NEW."organizationId"
    )) OR (NEW."settingJobId" IS NOT NULL AND NOT EXISTS (
      SELECT 1 FROM "WallSettingJob" job
      WHERE job."id" = NEW."settingJobId" AND job."organizationId" = NEW."organizationId"
    )) OR (NEW."routeHoldPlacementId" IS NOT NULL AND NOT EXISTS (
      SELECT 1 FROM "RouteHoldPlacement" placement
      WHERE placement."id" = NEW."routeHoldPlacementId"
        AND placement."organizationId" = NEW."organizationId"
        AND NEW."routeVersionId" IS NOT NULL
        AND placement."routeVersionId" = NEW."routeVersionId"
        AND placement."holdVariantId" = NEW."holdVariantId"
    )) OR (NEW."observedHoldId" IS NOT NULL AND NOT EXISTS (
      SELECT 1 FROM "WallObservedHold" observed
      WHERE observed."id" = NEW."observedHoldId" AND observed."organizationId" = NEW."organizationId"
    )) THEN RAISE EXCEPTION USING ERRCODE = '23514', MESSAGE = 'HoldInstallation scope mismatch'; END IF;

  ELSIF TG_TABLE_NAME = 'HoldInstallationAnchor' THEN
    IF NOT EXISTS (
      SELECT 1 FROM "HoldInstallation" installation
      JOIN "WallHole" hole ON hole."id" = NEW."wallHoleId"
      WHERE installation."id" = NEW."installationId"
        AND installation."organizationId" = NEW."organizationId"
        AND hole."organizationId" = NEW."organizationId"
        AND (installation."routeVersionId" IS NULL OR EXISTS (
          SELECT 1 FROM "RouteVersionWallSegment" scope
          WHERE scope."routeVersionId" = installation."routeVersionId"
            AND scope."wallSegmentId" = hole."wallSegmentId"
            AND scope."geometryVersionId" = hole."geometryVersionId"
        ))
    ) THEN RAISE EXCEPTION USING ERRCODE = '23514', MESSAGE = 'HoldInstallationAnchor scope mismatch'; END IF;

  ELSIF TG_TABLE_NAME = 'ClimbObservation' THEN
    IF NOT EXISTS (
      SELECT 1 FROM "RouteVersion" version
      JOIN "Route" route ON route."id" = version."routeId"
      WHERE version."id" = NEW."routeVersionId"
        AND version."routeId" = NEW."routeId"
        AND version."organizationId" = NEW."organizationId"
        AND route."organizationId" = NEW."organizationId"
        AND (NEW."wallSegmentId" IS NULL OR EXISTS (
          SELECT 1 FROM "RouteVersionWallSegment" scope
          WHERE scope."routeVersionId" = version."id" AND scope."wallSegmentId" = NEW."wallSegmentId"
        ))
    ) THEN RAISE EXCEPTION USING ERRCODE = '23514', MESSAGE = 'ClimbObservation route version scope mismatch'; END IF;
  END IF;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DO $$
DECLARE table_name TEXT;
BEGIN
  FOREACH table_name IN ARRAY ARRAY[
    'WallSegment', 'WallGeometryVersion', 'WallHole', 'WallSegmentAdjacency',
    'HoldModel', 'HoldInventoryMovement', 'HoldScan', 'HoldAsset', 'HoldInitializationEntry',
    'RouteVersion', 'RouteVersionWallSegment', 'RouteHoldPlacement', 'RouteHoldPlacementAnchor',
    'WallAsset', 'WallCapture', 'WallCaptureSegment', 'WallObservedHold', 'WallObservedHoldAnchor',
    'WallSettingJobSegment', 'HoldInstallation', 'HoldInstallationAnchor', 'ClimbObservation'
  ] LOOP
    EXECUTE format(
      'CREATE TRIGGER %I BEFORE INSERT OR UPDATE ON %I FOR EACH ROW EXECUTE FUNCTION "assert_domain_scope"()',
      table_name || '_scope_guard', table_name
    );
  END LOOP;
END $$;

CREATE OR REPLACE FUNCTION "assert_primary_anchor_exists"() RETURNS trigger AS $$
DECLARE parent_id TEXT;
DECLARE parent_exists BOOLEAN;
DECLARE primary_exists BOOLEAN;
BEGIN
  IF TG_TABLE_NAME = 'RouteHoldPlacement' THEN
    parent_id := NEW."id";
  ELSIF TG_OP = 'DELETE' THEN
    parent_id := OLD."placementId";
  ELSE
    parent_id := NEW."placementId";
  END IF;
  SELECT EXISTS (SELECT 1 FROM "RouteHoldPlacement" WHERE "id" = parent_id) INTO parent_exists;
  IF parent_exists THEN
    SELECT EXISTS (
      SELECT 1 FROM "RouteHoldPlacementAnchor"
      WHERE "placementId" = parent_id AND "role" = 'PRIMARY'
    ) INTO primary_exists;
    IF NOT primary_exists THEN
      RAISE EXCEPTION USING ERRCODE = '23514', MESSAGE = 'RouteHoldPlacement requires exactly one primary anchor';
    END IF;
  END IF;
  RETURN NULL;
END;
$$ LANGUAGE plpgsql;

CREATE CONSTRAINT TRIGGER "RouteHoldPlacementAnchor_primary_required"
AFTER INSERT OR UPDATE OR DELETE ON "RouteHoldPlacementAnchor"
DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION "assert_primary_anchor_exists"();

CREATE CONSTRAINT TRIGGER "RouteHoldPlacement_primary_required"
AFTER INSERT OR UPDATE ON "RouteHoldPlacement"
DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION "assert_primary_anchor_exists"();

CREATE OR REPLACE FUNCTION "assert_installation_primary_anchor_exists"() RETURNS trigger AS $$
DECLARE parent_id TEXT;
BEGIN
  IF TG_TABLE_NAME = 'HoldInstallation' THEN
    parent_id := NEW."id";
  ELSIF TG_OP = 'DELETE' THEN
    parent_id := OLD."installationId";
  ELSE
    parent_id := NEW."installationId";
  END IF;
  IF EXISTS (SELECT 1 FROM "HoldInstallation" WHERE "id" = parent_id AND "status" = 'INSTALLED')
     AND NOT EXISTS (
       SELECT 1 FROM "HoldInstallationAnchor"
       WHERE "installationId" = parent_id AND "role" = 'PRIMARY' AND "releasedAt" IS NULL
     ) THEN
    RAISE EXCEPTION USING ERRCODE = '23514', MESSAGE = 'Installed hold requires exactly one active primary anchor';
  END IF;
  RETURN NULL;
END;
$$ LANGUAGE plpgsql;

CREATE CONSTRAINT TRIGGER "HoldInstallationAnchor_primary_required"
AFTER INSERT OR UPDATE OR DELETE ON "HoldInstallationAnchor"
DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION "assert_installation_primary_anchor_exists"();

CREATE CONSTRAINT TRIGGER "HoldInstallation_primary_required"
AFTER INSERT OR UPDATE ON "HoldInstallation"
DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION "assert_installation_primary_anchor_exists"();

CREATE OR REPLACE FUNCTION "assert_observed_hold_primary_anchor_exists"() RETURNS trigger AS $$
DECLARE parent_id TEXT;
BEGIN
  IF TG_TABLE_NAME = 'WallObservedHold' THEN
    parent_id := NEW."id";
  ELSIF TG_OP = 'DELETE' THEN
    parent_id := OLD."observedHoldId";
  ELSE
    parent_id := NEW."observedHoldId";
  END IF;
  IF EXISTS (SELECT 1 FROM "WallObservedHold" WHERE "id" = parent_id)
     AND NOT EXISTS (
       SELECT 1 FROM "WallObservedHoldAnchor"
       WHERE "observedHoldId" = parent_id AND "role" = 'PRIMARY'
     ) THEN
    RAISE EXCEPTION USING ERRCODE = '23514', MESSAGE = 'Observed hold requires exactly one primary anchor';
  END IF;
  RETURN NULL;
END;
$$ LANGUAGE plpgsql;

CREATE CONSTRAINT TRIGGER "WallObservedHoldAnchor_primary_required"
AFTER INSERT OR UPDATE OR DELETE ON "WallObservedHoldAnchor"
DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION "assert_observed_hold_primary_anchor_exists"();

CREATE CONSTRAINT TRIGGER "WallObservedHold_primary_required"
AFTER INSERT OR UPDATE ON "WallObservedHold"
DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION "assert_observed_hold_primary_anchor_exists"();
