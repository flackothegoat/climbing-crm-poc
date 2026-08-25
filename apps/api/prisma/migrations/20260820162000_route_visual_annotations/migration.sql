-- Versioned route visual annotations use wall-local normalized coordinates.
-- They are independent from the scan mesh and can be projected to 3D, photos or calibrated video.

CREATE TYPE "RouteVisualAnnotationStatus" AS ENUM ('DRAFT', 'CONFIRMED', 'RETIRED');
CREATE TYPE "RouteVisualAnnotationSource" AS ENUM ('MANUAL', 'AI_SUGGESTED', 'IMPORTED');

CREATE TABLE "RouteVisualAnnotation" (
  "id" TEXT NOT NULL,
  "organizationId" TEXT NOT NULL,
  "routeVersionId" TEXT NOT NULL,
  "revision" INTEGER NOT NULL,
  "status" "RouteVisualAnnotationStatus" NOT NULL DEFAULT 'DRAFT',
  "source" "RouteVisualAnnotationSource" NOT NULL DEFAULT 'MANUAL',
  "activeRouteVersionKey" TEXT,
  "createdByAccountId" TEXT NOT NULL,
  "confirmedByAccountId" TEXT,
  "confirmedAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "RouteVisualAnnotation_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "RouteVisualPoint" (
  "id" TEXT NOT NULL,
  "organizationId" TEXT NOT NULL,
  "annotationId" TEXT NOT NULL,
  "wallSegmentId" TEXT NOT NULL,
  "ordinal" INTEGER NOT NULL,
  "role" "RoutePlacementRole" NOT NULL DEFAULT 'NORMAL',
  "uNormalized" DOUBLE PRECISION NOT NULL,
  "vNormalized" DOUBLE PRECISION NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "RouteVisualPoint_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "RouteVisualAnnotation_activeRouteVersionKey_key"
  ON "RouteVisualAnnotation"("activeRouteVersionKey");
CREATE UNIQUE INDEX "RouteVisualAnnotation_routeVersionId_revision_key"
  ON "RouteVisualAnnotation"("routeVersionId", "revision");
CREATE INDEX "RouteVisualAnnotation_organizationId_status_updatedAt_idx"
  ON "RouteVisualAnnotation"("organizationId", "status", "updatedAt");
CREATE INDEX "RouteVisualAnnotation_routeVersionId_status_idx"
  ON "RouteVisualAnnotation"("routeVersionId", "status");

CREATE UNIQUE INDEX "RouteVisualPoint_annotationId_ordinal_key"
  ON "RouteVisualPoint"("annotationId", "ordinal");
CREATE INDEX "RouteVisualPoint_organizationId_wallSegmentId_idx"
  ON "RouteVisualPoint"("organizationId", "wallSegmentId");
CREATE INDEX "RouteVisualPoint_wallSegmentId_idx" ON "RouteVisualPoint"("wallSegmentId");

ALTER TABLE "RouteVisualAnnotation"
  ADD CONSTRAINT "RouteVisualAnnotation_organizationId_fkey"
  FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  ADD CONSTRAINT "RouteVisualAnnotation_routeVersionId_fkey"
  FOREIGN KEY ("routeVersionId") REFERENCES "RouteVersion"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  ADD CONSTRAINT "RouteVisualAnnotation_createdByAccountId_fkey"
  FOREIGN KEY ("createdByAccountId") REFERENCES "Account"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  ADD CONSTRAINT "RouteVisualAnnotation_confirmedByAccountId_fkey"
  FOREIGN KEY ("confirmedByAccountId") REFERENCES "Account"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "RouteVisualPoint"
  ADD CONSTRAINT "RouteVisualPoint_organizationId_fkey"
  FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  ADD CONSTRAINT "RouteVisualPoint_annotationId_fkey"
  FOREIGN KEY ("annotationId") REFERENCES "RouteVisualAnnotation"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  ADD CONSTRAINT "RouteVisualPoint_wallSegmentId_fkey"
  FOREIGN KEY ("wallSegmentId") REFERENCES "WallSegment"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "RouteVisualAnnotation"
  ADD CONSTRAINT "RouteVisualAnnotation_revision_check" CHECK ("revision" > 0),
  ADD CONSTRAINT "RouteVisualAnnotation_lifecycle_check" CHECK (
    ("status" = 'DRAFT' AND "activeRouteVersionKey" IS NULL
      AND "confirmedByAccountId" IS NULL AND "confirmedAt" IS NULL)
    OR ("status" = 'CONFIRMED' AND "activeRouteVersionKey" = "routeVersionId"
      AND "confirmedByAccountId" IS NOT NULL AND "confirmedAt" IS NOT NULL)
    OR ("status" = 'RETIRED' AND "activeRouteVersionKey" IS NULL
      AND "confirmedByAccountId" IS NOT NULL AND "confirmedAt" IS NOT NULL)
  );

ALTER TABLE "RouteVisualPoint"
  ADD CONSTRAINT "RouteVisualPoint_ordinal_check" CHECK ("ordinal" >= 0),
  ADD CONSTRAINT "RouteVisualPoint_coordinate_check" CHECK (
    "uNormalized" >= 0 AND "uNormalized" <= 1
    AND "vNormalized" >= 0 AND "vNormalized" <= 1
  );

CREATE OR REPLACE FUNCTION "assert_route_visual_scope"() RETURNS trigger AS $$
BEGIN
  IF TG_TABLE_NAME = 'RouteVisualAnnotation' THEN
    IF NOT EXISTS (
      SELECT 1
      FROM "RouteVersion" version
      JOIN "Membership" creator ON creator."accountId" = NEW."createdByAccountId"
      WHERE version."id" = NEW."routeVersionId"
        AND version."organizationId" = NEW."organizationId"
        AND creator."organizationId" = NEW."organizationId"
        AND (NEW."confirmedByAccountId" IS NULL OR EXISTS (
          SELECT 1 FROM "Membership" confirmer
          WHERE confirmer."accountId" = NEW."confirmedByAccountId"
            AND confirmer."organizationId" = NEW."organizationId"
        ))
    ) THEN
      RAISE EXCEPTION USING ERRCODE = '23514', MESSAGE = 'RouteVisualAnnotation scope mismatch';
    END IF;
  ELSIF TG_TABLE_NAME = 'RouteVisualPoint' THEN
    IF NOT EXISTS (
      SELECT 1
      FROM "RouteVisualAnnotation" annotation
      JOIN "WallSegment" segment ON segment."id" = NEW."wallSegmentId"
      JOIN "RouteVersionWallSegment" route_scope
        ON route_scope."routeVersionId" = annotation."routeVersionId"
       AND route_scope."wallSegmentId" = NEW."wallSegmentId"
      WHERE annotation."id" = NEW."annotationId"
        AND annotation."organizationId" = NEW."organizationId"
        AND segment."organizationId" = NEW."organizationId"
        AND route_scope."organizationId" = NEW."organizationId"
    ) THEN
      RAISE EXCEPTION USING ERRCODE = '23514', MESSAGE = 'RouteVisualPoint scope mismatch';
    END IF;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER "RouteVisualAnnotation_scope_guard"
  BEFORE INSERT OR UPDATE ON "RouteVisualAnnotation"
  FOR EACH ROW EXECUTE FUNCTION "assert_route_visual_scope"();

CREATE TRIGGER "RouteVisualPoint_scope_guard"
  BEFORE INSERT OR UPDATE ON "RouteVisualPoint"
  FOR EACH ROW EXECUTE FUNCTION "assert_route_visual_scope"();
