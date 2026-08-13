-- Deferred anchor checks must validate both sides when an anchor is moved to another parent.

CREATE OR REPLACE FUNCTION "assert_primary_anchor_exists"() RETURNS trigger AS $$
DECLARE parent_id TEXT;
DECLARE old_parent_id TEXT;
BEGIN
  IF TG_TABLE_NAME = 'RouteHoldPlacement' THEN
    parent_id := NEW."id";
  ELSIF TG_OP = 'DELETE' THEN
    parent_id := OLD."placementId";
  ELSE
    parent_id := NEW."placementId";
    IF TG_OP = 'UPDATE' AND OLD."placementId" IS DISTINCT FROM NEW."placementId" THEN
      old_parent_id := OLD."placementId";
    END IF;
  END IF;

  IF old_parent_id IS NOT NULL
     AND EXISTS (SELECT 1 FROM "RouteHoldPlacement" WHERE "id" = old_parent_id)
     AND NOT EXISTS (
       SELECT 1 FROM "RouteHoldPlacementAnchor"
       WHERE "placementId" = old_parent_id AND "role" = 'PRIMARY'
     ) THEN
    RAISE EXCEPTION USING ERRCODE = '23514', MESSAGE = 'RouteHoldPlacement requires exactly one primary anchor';
  END IF;

  IF EXISTS (SELECT 1 FROM "RouteHoldPlacement" WHERE "id" = parent_id)
     AND NOT EXISTS (
       SELECT 1 FROM "RouteHoldPlacementAnchor"
       WHERE "placementId" = parent_id AND "role" = 'PRIMARY'
     ) THEN
    RAISE EXCEPTION USING ERRCODE = '23514', MESSAGE = 'RouteHoldPlacement requires exactly one primary anchor';
  END IF;
  RETURN NULL;
END;
$$ LANGUAGE plpgsql;

CREATE OR REPLACE FUNCTION "assert_installation_primary_anchor_exists"() RETURNS trigger AS $$
DECLARE parent_id TEXT;
DECLARE old_parent_id TEXT;
BEGIN
  IF TG_TABLE_NAME = 'HoldInstallation' THEN
    parent_id := NEW."id";
  ELSIF TG_OP = 'DELETE' THEN
    parent_id := OLD."installationId";
  ELSE
    parent_id := NEW."installationId";
    IF TG_OP = 'UPDATE' AND OLD."installationId" IS DISTINCT FROM NEW."installationId" THEN
      old_parent_id := OLD."installationId";
    END IF;
  END IF;

  IF old_parent_id IS NOT NULL
     AND EXISTS (SELECT 1 FROM "HoldInstallation" WHERE "id" = old_parent_id AND "status" = 'INSTALLED')
     AND NOT EXISTS (
       SELECT 1 FROM "HoldInstallationAnchor"
       WHERE "installationId" = old_parent_id AND "role" = 'PRIMARY' AND "releasedAt" IS NULL
     ) THEN
    RAISE EXCEPTION USING ERRCODE = '23514', MESSAGE = 'Installed hold requires exactly one active primary anchor';
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

CREATE OR REPLACE FUNCTION "assert_observed_hold_primary_anchor_exists"() RETURNS trigger AS $$
DECLARE parent_id TEXT;
DECLARE old_parent_id TEXT;
BEGIN
  IF TG_TABLE_NAME = 'WallObservedHold' THEN
    parent_id := NEW."id";
  ELSIF TG_OP = 'DELETE' THEN
    parent_id := OLD."observedHoldId";
  ELSE
    parent_id := NEW."observedHoldId";
    IF TG_OP = 'UPDATE' AND OLD."observedHoldId" IS DISTINCT FROM NEW."observedHoldId" THEN
      old_parent_id := OLD."observedHoldId";
    END IF;
  END IF;

  IF old_parent_id IS NOT NULL
     AND EXISTS (SELECT 1 FROM "WallObservedHold" WHERE "id" = old_parent_id)
     AND NOT EXISTS (
       SELECT 1 FROM "WallObservedHoldAnchor"
       WHERE "observedHoldId" = old_parent_id AND "role" = 'PRIMARY'
     ) THEN
    RAISE EXCEPTION USING ERRCODE = '23514', MESSAGE = 'Observed hold requires exactly one primary anchor';
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
