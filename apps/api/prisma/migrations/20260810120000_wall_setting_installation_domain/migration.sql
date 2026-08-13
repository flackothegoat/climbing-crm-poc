-- Additive foundation for versioned wall geometry, cross-segment routes,
-- multi-hole placements, wall captures, setting jobs and actual installations.

CREATE TYPE "WallGeometryVersionStatus" AS ENUM ('DRAFT', 'PUBLISHED', 'RETIRED');
CREATE TYPE "WallAssetKind" AS ENUM ('RAW_SCAN', 'MODEL_3D', 'PHOTO', 'REFERENCE_DOCUMENT');
CREATE TYPE "WallAssetStatus" AS ENUM ('READY', 'FAILED', 'DELETED');
CREATE TYPE "WallCaptureKind" AS ENUM ('AS_IS', 'EMPTY_WALL');
CREATE TYPE "WallCaptureSource" AS ENUM ('SCANNER', 'MANUAL_IMPORT', 'PHOTO_RECONSTRUCTION');
CREATE TYPE "WallCaptureStatus" AS ENUM ('PROCESSING', 'REVIEW_PENDING', 'CONFIRMED', 'FAILED');
CREATE TYPE "HoldObservationMatchStatus" AS ENUM ('UNMATCHED', 'SUGGESTED', 'CONFIRMED', 'REJECTED');
CREATE TYPE "PlacementAnchorRole" AS ENUM ('PRIMARY', 'SECONDARY');
CREATE TYPE "WallSettingJobStatus" AS ENUM (
  'DRAFT',
  'READY',
  'TEARDOWN_IN_PROGRESS',
  'WALL_EMPTY',
  'INSTALL_IN_PROGRESS',
  'COMPLETED',
  'CANCELLED'
);
CREATE TYPE "HoldInstallationStatus" AS ENUM ('INSTALLED', 'REMOVED');
CREATE TYPE "HoldInstallationSource" AS ENUM ('BASELINE', 'SETTING_JOB', 'MANUAL');

ALTER TABLE "RouteVersion" ADD COLUMN "settingJobId" TEXT;
ALTER TABLE "WallHole" ADD COLUMN "geometryVersionId" TEXT;

CREATE TABLE "WallGeometryVersion" (
  "id" TEXT NOT NULL,
  "organizationId" TEXT NOT NULL,
  "wallSegmentId" TEXT NOT NULL,
  "versionNumber" INTEGER NOT NULL,
  "status" "WallGeometryVersionStatus" NOT NULL DEFAULT 'DRAFT',
  "calibration" "WallCalibrationStatus" NOT NULL DEFAULT 'SURVEY_ESTIMATE',
  "widthMm" INTEGER NOT NULL,
  "heightMm" INTEGER NOT NULL,
  "surfaceHeightMm" INTEGER,
  "angleFromVerticalDegrees" DOUBLE PRECISION,
  "coordinateSystem" JSONB,
  "note" TEXT,
  "createdByAccountId" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "WallGeometryVersion_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "WallGeometryVersion_number_check" CHECK ("versionNumber" > 0),
  CONSTRAINT "WallGeometryVersion_dimensions_check" CHECK ("widthMm" > 0 AND "heightMm" > 0),
  CONSTRAINT "WallGeometryVersion_surface_height_check" CHECK (
    "surfaceHeightMm" IS NULL OR "surfaceHeightMm" > 0
  )
);

CREATE TABLE "WallAsset" (
  "id" TEXT NOT NULL,
  "organizationId" TEXT NOT NULL,
  "geometryVersionId" TEXT NOT NULL,
  "kind" "WallAssetKind" NOT NULL,
  "status" "WallAssetStatus" NOT NULL DEFAULT 'READY',
  "objectKey" TEXT NOT NULL,
  "originalFileName" TEXT NOT NULL,
  "contentType" TEXT NOT NULL,
  "sizeBytes" INTEGER NOT NULL,
  "checksumSha256" TEXT NOT NULL,
  "metadata" JSONB,
  "sourceAssetId" TEXT,
  "createdByAccountId" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "WallAsset_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "WallAsset_size_check" CHECK ("sizeBytes" > 0)
);

CREATE TABLE "WallSettingJob" (
  "id" TEXT NOT NULL,
  "organizationId" TEXT NOT NULL,
  "code" TEXT NOT NULL,
  "name" TEXT NOT NULL,
  "status" "WallSettingJobStatus" NOT NULL DEFAULT 'DRAFT',
  "note" TEXT,
  "startedAt" TIMESTAMP(3),
  "completedAt" TIMESTAMP(3),
  "createdByAccountId" TEXT NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "WallSettingJob_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "WallSettingJob_time_check" CHECK (
    "completedAt" IS NULL OR ("startedAt" IS NOT NULL AND "completedAt" >= "startedAt")
  )
);

CREATE TABLE "WallCapture" (
  "id" TEXT NOT NULL,
  "organizationId" TEXT NOT NULL,
  "settingJobId" TEXT,
  "kind" "WallCaptureKind" NOT NULL,
  "source" "WallCaptureSource" NOT NULL,
  "status" "WallCaptureStatus" NOT NULL DEFAULT 'PROCESSING',
  "capturedAt" TIMESTAMP(3) NOT NULL,
  "note" TEXT,
  "metadata" JSONB,
  "createdByAccountId" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "WallCapture_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "WallCaptureSegment" (
  "id" TEXT NOT NULL,
  "captureId" TEXT NOT NULL,
  "wallSegmentId" TEXT NOT NULL,
  "geometryVersionId" TEXT,
  "ordinal" INTEGER NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "WallCaptureSegment_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "WallCaptureSegment_ordinal_check" CHECK ("ordinal" >= 0)
);

CREATE TABLE "WallObservedHold" (
  "id" TEXT NOT NULL,
  "organizationId" TEXT NOT NULL,
  "captureId" TEXT NOT NULL,
  "matchedVariantId" TEXT,
  "matchStatus" "HoldObservationMatchStatus" NOT NULL DEFAULT 'UNMATCHED',
  "matchConfidence" DOUBLE PRECISION,
  "rotationDegrees" INTEGER,
  "metadata" JSONB,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "WallObservedHold_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "WallObservedHold_confidence_check" CHECK (
    "matchConfidence" IS NULL OR ("matchConfidence" >= 0 AND "matchConfidence" <= 1)
  ),
  CONSTRAINT "WallObservedHold_rotation_check" CHECK (
    "rotationDegrees" IS NULL OR "rotationDegrees" BETWEEN -359 AND 359
  ),
  CONSTRAINT "WallObservedHold_match_check" CHECK (
    ("matchStatus" IN ('UNMATCHED', 'REJECTED') AND "matchedVariantId" IS NULL)
    OR ("matchStatus" IN ('SUGGESTED', 'CONFIRMED') AND "matchedVariantId" IS NOT NULL)
  )
);

CREATE TABLE "WallObservedHoldAnchor" (
  "id" TEXT NOT NULL,
  "observedHoldId" TEXT NOT NULL,
  "wallHoleId" TEXT NOT NULL,
  "role" "PlacementAnchorRole" NOT NULL,
  "ordinal" INTEGER NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "WallObservedHoldAnchor_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "WallObservedHoldAnchor_ordinal_check" CHECK ("ordinal" >= 0)
);

CREATE TABLE "WallSettingJobSegment" (
  "id" TEXT NOT NULL,
  "settingJobId" TEXT NOT NULL,
  "wallSegmentId" TEXT NOT NULL,
  "geometryVersionId" TEXT NOT NULL,
  "ordinal" INTEGER NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "WallSettingJobSegment_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "WallSettingJobSegment_ordinal_check" CHECK ("ordinal" >= 0)
);

CREATE TABLE "RouteVersionWallSegment" (
  "id" TEXT NOT NULL,
  "organizationId" TEXT NOT NULL,
  "routeVersionId" TEXT NOT NULL,
  "wallSegmentId" TEXT NOT NULL,
  "geometryVersionId" TEXT NOT NULL,
  "ordinal" INTEGER NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "RouteVersionWallSegment_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "RouteVersionWallSegment_ordinal_check" CHECK ("ordinal" >= 0)
);

CREATE TABLE "RouteHoldPlacementAnchor" (
  "id" TEXT NOT NULL,
  "organizationId" TEXT NOT NULL,
  "placementId" TEXT NOT NULL,
  "wallHoleId" TEXT NOT NULL,
  "role" "PlacementAnchorRole" NOT NULL,
  "ordinal" INTEGER NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "RouteHoldPlacementAnchor_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "RouteHoldPlacementAnchor_ordinal_check" CHECK ("ordinal" >= 0)
);

CREATE TABLE "HoldInstallation" (
  "id" TEXT NOT NULL,
  "organizationId" TEXT NOT NULL,
  "holdVariantId" TEXT NOT NULL,
  "routeVersionId" TEXT,
  "routeHoldPlacementId" TEXT,
  "settingJobId" TEXT,
  "observedHoldId" TEXT,
  "status" "HoldInstallationStatus" NOT NULL DEFAULT 'INSTALLED',
  "source" "HoldInstallationSource" NOT NULL,
  "installedAt" TIMESTAMP(3) NOT NULL,
  "removedAt" TIMESTAMP(3),
  "installedByAccountId" TEXT,
  "removedByAccountId" TEXT,
  "note" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "HoldInstallation_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "HoldInstallation_status_check" CHECK (
    ("status" = 'INSTALLED' AND "removedAt" IS NULL AND "removedByAccountId" IS NULL)
    OR ("status" = 'REMOVED' AND "removedAt" IS NOT NULL)
  ),
  CONSTRAINT "HoldInstallation_time_check" CHECK (
    "removedAt" IS NULL OR "removedAt" >= "installedAt"
  )
);

CREATE TABLE "HoldInstallationAnchor" (
  "id" TEXT NOT NULL,
  "organizationId" TEXT NOT NULL,
  "installationId" TEXT NOT NULL,
  "wallHoleId" TEXT NOT NULL,
  "role" "PlacementAnchorRole" NOT NULL,
  "ordinal" INTEGER NOT NULL,
  "releasedAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "HoldInstallationAnchor_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "HoldInstallationAnchor_ordinal_check" CHECK ("ordinal" >= 0)
);

CREATE UNIQUE INDEX "WallGeometryVersion_wallSegmentId_versionNumber_key"
  ON "WallGeometryVersion"("wallSegmentId", "versionNumber");
CREATE UNIQUE INDEX "WallGeometryVersion_one_published_per_segment_key"
  ON "WallGeometryVersion"("wallSegmentId") WHERE "status" = 'PUBLISHED';
CREATE INDEX "WallGeometryVersion_organizationId_status_updatedAt_idx"
  ON "WallGeometryVersion"("organizationId", "status", "updatedAt");

CREATE UNIQUE INDEX "WallAsset_objectKey_key" ON "WallAsset"("objectKey");
CREATE INDEX "WallAsset_organizationId_createdAt_idx" ON "WallAsset"("organizationId", "createdAt");
CREATE INDEX "WallAsset_geometryVersionId_kind_idx" ON "WallAsset"("geometryVersionId", "kind");
CREATE INDEX "WallAsset_sourceAssetId_idx" ON "WallAsset"("sourceAssetId");

CREATE UNIQUE INDEX "WallSettingJob_organizationId_code_key"
  ON "WallSettingJob"("organizationId", "code");
CREATE INDEX "WallSettingJob_organizationId_status_updatedAt_idx"
  ON "WallSettingJob"("organizationId", "status", "updatedAt");

CREATE INDEX "WallCapture_organizationId_capturedAt_idx"
  ON "WallCapture"("organizationId", "capturedAt");
CREATE INDEX "WallCapture_settingJobId_idx" ON "WallCapture"("settingJobId");
CREATE UNIQUE INDEX "WallCaptureSegment_captureId_wallSegmentId_key"
  ON "WallCaptureSegment"("captureId", "wallSegmentId");
CREATE UNIQUE INDEX "WallCaptureSegment_captureId_ordinal_key"
  ON "WallCaptureSegment"("captureId", "ordinal");
CREATE INDEX "WallCaptureSegment_wallSegmentId_idx" ON "WallCaptureSegment"("wallSegmentId");
CREATE INDEX "WallCaptureSegment_geometryVersionId_idx" ON "WallCaptureSegment"("geometryVersionId");

CREATE INDEX "WallObservedHold_organizationId_matchStatus_createdAt_idx"
  ON "WallObservedHold"("organizationId", "matchStatus", "createdAt");
CREATE INDEX "WallObservedHold_captureId_idx" ON "WallObservedHold"("captureId");
CREATE INDEX "WallObservedHold_matchedVariantId_idx" ON "WallObservedHold"("matchedVariantId");
CREATE UNIQUE INDEX "WallObservedHoldAnchor_observedHoldId_wallHoleId_key"
  ON "WallObservedHoldAnchor"("observedHoldId", "wallHoleId");
CREATE UNIQUE INDEX "WallObservedHoldAnchor_observedHoldId_ordinal_key"
  ON "WallObservedHoldAnchor"("observedHoldId", "ordinal");
CREATE UNIQUE INDEX "WallObservedHoldAnchor_one_primary_key"
  ON "WallObservedHoldAnchor"("observedHoldId") WHERE "role" = 'PRIMARY';
CREATE INDEX "WallObservedHoldAnchor_wallHoleId_idx" ON "WallObservedHoldAnchor"("wallHoleId");

CREATE UNIQUE INDEX "WallSettingJobSegment_settingJobId_wallSegmentId_key"
  ON "WallSettingJobSegment"("settingJobId", "wallSegmentId");
CREATE UNIQUE INDEX "WallSettingJobSegment_settingJobId_ordinal_key"
  ON "WallSettingJobSegment"("settingJobId", "ordinal");
CREATE INDEX "WallSettingJobSegment_wallSegmentId_idx" ON "WallSettingJobSegment"("wallSegmentId");
CREATE INDEX "WallSettingJobSegment_geometryVersionId_idx"
  ON "WallSettingJobSegment"("geometryVersionId");

CREATE UNIQUE INDEX "RouteVersionWallSegment_routeVersionId_wallSegmentId_key"
  ON "RouteVersionWallSegment"("routeVersionId", "wallSegmentId");
CREATE UNIQUE INDEX "RouteVersionWallSegment_routeVersionId_ordinal_key"
  ON "RouteVersionWallSegment"("routeVersionId", "ordinal");
CREATE INDEX "RouteVersionWallSegment_organizationId_wallSegmentId_idx"
  ON "RouteVersionWallSegment"("organizationId", "wallSegmentId");
CREATE INDEX "RouteVersionWallSegment_geometryVersionId_idx"
  ON "RouteVersionWallSegment"("geometryVersionId");

CREATE UNIQUE INDEX "RouteHoldPlacementAnchor_placementId_wallHoleId_key"
  ON "RouteHoldPlacementAnchor"("placementId", "wallHoleId");
CREATE UNIQUE INDEX "RouteHoldPlacementAnchor_placementId_ordinal_key"
  ON "RouteHoldPlacementAnchor"("placementId", "ordinal");
CREATE UNIQUE INDEX "RouteHoldPlacementAnchor_one_primary_key"
  ON "RouteHoldPlacementAnchor"("placementId") WHERE "role" = 'PRIMARY';
CREATE INDEX "RouteHoldPlacementAnchor_organizationId_wallHoleId_idx"
  ON "RouteHoldPlacementAnchor"("organizationId", "wallHoleId");

CREATE UNIQUE INDEX "HoldInstallation_observedHoldId_key" ON "HoldInstallation"("observedHoldId");
CREATE INDEX "HoldInstallation_organizationId_status_installedAt_idx"
  ON "HoldInstallation"("organizationId", "status", "installedAt");
CREATE INDEX "HoldInstallation_holdVariantId_status_idx"
  ON "HoldInstallation"("holdVariantId", "status");
CREATE INDEX "HoldInstallation_routeVersionId_idx" ON "HoldInstallation"("routeVersionId");
CREATE INDEX "HoldInstallation_routeHoldPlacementId_idx"
  ON "HoldInstallation"("routeHoldPlacementId");
CREATE INDEX "HoldInstallation_settingJobId_idx" ON "HoldInstallation"("settingJobId");

CREATE UNIQUE INDEX "HoldInstallationAnchor_installationId_wallHoleId_key"
  ON "HoldInstallationAnchor"("installationId", "wallHoleId");
CREATE UNIQUE INDEX "HoldInstallationAnchor_installationId_ordinal_key"
  ON "HoldInstallationAnchor"("installationId", "ordinal");
CREATE UNIQUE INDEX "HoldInstallationAnchor_one_primary_key"
  ON "HoldInstallationAnchor"("installationId") WHERE "role" = 'PRIMARY';
CREATE UNIQUE INDEX "HoldInstallationAnchor_active_wallHole_key"
  ON "HoldInstallationAnchor"("wallHoleId") WHERE "releasedAt" IS NULL;
CREATE INDEX "HoldInstallationAnchor_organizationId_wallHoleId_releasedAt_idx"
  ON "HoldInstallationAnchor"("organizationId", "wallHoleId", "releasedAt");

CREATE INDEX "RouteVersion_settingJobId_idx" ON "RouteVersion"("settingJobId");
CREATE INDEX "WallHole_geometryVersionId_idx" ON "WallHole"("geometryVersionId");

-- Backfill a published, survey-calibrated geometry baseline for every existing segment.
INSERT INTO "WallGeometryVersion" (
  "id",
  "organizationId",
  "wallSegmentId",
  "versionNumber",
  "status",
  "calibration",
  "widthMm",
  "heightMm",
  "surfaceHeightMm",
  "angleFromVerticalDegrees",
  "coordinateSystem",
  "note",
  "createdAt",
  "updatedAt"
)
SELECT
  'legacy-geometry-' || segment."id",
  segment."organizationId",
  segment."id",
  1,
  'PUBLISHED'::"WallGeometryVersionStatus",
  segment."calibration",
  segment."widthMm",
  segment."heightMm",
  segment."surfaceHeightMm",
  segment."angleFromVerticalDegrees",
  segment."metadata",
  '由 2026-08-10 兼容迁移从原 WallSegment 字段建立。',
  segment."createdAt",
  CURRENT_TIMESTAMP
FROM "WallSegment" AS segment;

UPDATE "WallHole" AS hole
SET "geometryVersionId" = 'legacy-geometry-' || hole."wallSegmentId";

-- Preserve the old single-segment route meaning as the first segment of every version.
INSERT INTO "RouteVersionWallSegment" (
  "id",
  "organizationId",
  "routeVersionId",
  "wallSegmentId",
  "geometryVersionId",
  "ordinal"
)
SELECT
  'legacy-route-wall-' || version."id",
  version."organizationId",
  version."id",
  route."wallSegmentId",
  'legacy-geometry-' || route."wallSegmentId",
  0
FROM "RouteVersion" AS version
JOIN "Route" AS route ON route."id" = version."routeId";

-- The legacy wallHoleId remains the compatibility primary hole and is mirrored as an anchor.
INSERT INTO "RouteHoldPlacementAnchor" (
  "id",
  "organizationId",
  "placementId",
  "wallHoleId",
  "role",
  "ordinal"
)
SELECT
  'legacy-placement-anchor-' || placement."id",
  placement."organizationId",
  placement."id",
  placement."wallHoleId",
  'PRIMARY'::"PlacementAnchorRole",
  0
FROM "RouteHoldPlacement" AS placement;

ALTER TABLE "WallHole"
  ADD CONSTRAINT "WallHole_geometryVersionId_fkey"
  FOREIGN KEY ("geometryVersionId") REFERENCES "WallGeometryVersion"("id")
  ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "RouteVersion"
  ADD CONSTRAINT "RouteVersion_settingJobId_fkey"
  FOREIGN KEY ("settingJobId") REFERENCES "WallSettingJob"("id")
  ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "WallGeometryVersion"
  ADD CONSTRAINT "WallGeometryVersion_organizationId_fkey"
  FOREIGN KEY ("organizationId") REFERENCES "Organization"("id")
  ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "WallGeometryVersion"
  ADD CONSTRAINT "WallGeometryVersion_wallSegmentId_fkey"
  FOREIGN KEY ("wallSegmentId") REFERENCES "WallSegment"("id")
  ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "WallGeometryVersion"
  ADD CONSTRAINT "WallGeometryVersion_createdByAccountId_fkey"
  FOREIGN KEY ("createdByAccountId") REFERENCES "Account"("id")
  ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "WallAsset"
  ADD CONSTRAINT "WallAsset_organizationId_fkey"
  FOREIGN KEY ("organizationId") REFERENCES "Organization"("id")
  ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "WallAsset"
  ADD CONSTRAINT "WallAsset_geometryVersionId_fkey"
  FOREIGN KEY ("geometryVersionId") REFERENCES "WallGeometryVersion"("id")
  ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "WallAsset"
  ADD CONSTRAINT "WallAsset_sourceAssetId_fkey"
  FOREIGN KEY ("sourceAssetId") REFERENCES "WallAsset"("id")
  ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "WallAsset"
  ADD CONSTRAINT "WallAsset_createdByAccountId_fkey"
  FOREIGN KEY ("createdByAccountId") REFERENCES "Account"("id")
  ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "WallSettingJob"
  ADD CONSTRAINT "WallSettingJob_organizationId_fkey"
  FOREIGN KEY ("organizationId") REFERENCES "Organization"("id")
  ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "WallSettingJob"
  ADD CONSTRAINT "WallSettingJob_createdByAccountId_fkey"
  FOREIGN KEY ("createdByAccountId") REFERENCES "Account"("id")
  ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "WallCapture"
  ADD CONSTRAINT "WallCapture_organizationId_fkey"
  FOREIGN KEY ("organizationId") REFERENCES "Organization"("id")
  ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "WallCapture"
  ADD CONSTRAINT "WallCapture_settingJobId_fkey"
  FOREIGN KEY ("settingJobId") REFERENCES "WallSettingJob"("id")
  ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "WallCapture"
  ADD CONSTRAINT "WallCapture_createdByAccountId_fkey"
  FOREIGN KEY ("createdByAccountId") REFERENCES "Account"("id")
  ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "WallCaptureSegment"
  ADD CONSTRAINT "WallCaptureSegment_captureId_fkey"
  FOREIGN KEY ("captureId") REFERENCES "WallCapture"("id")
  ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "WallCaptureSegment"
  ADD CONSTRAINT "WallCaptureSegment_wallSegmentId_fkey"
  FOREIGN KEY ("wallSegmentId") REFERENCES "WallSegment"("id")
  ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "WallCaptureSegment"
  ADD CONSTRAINT "WallCaptureSegment_geometryVersionId_fkey"
  FOREIGN KEY ("geometryVersionId") REFERENCES "WallGeometryVersion"("id")
  ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "WallObservedHold"
  ADD CONSTRAINT "WallObservedHold_organizationId_fkey"
  FOREIGN KEY ("organizationId") REFERENCES "Organization"("id")
  ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "WallObservedHold"
  ADD CONSTRAINT "WallObservedHold_captureId_fkey"
  FOREIGN KEY ("captureId") REFERENCES "WallCapture"("id")
  ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "WallObservedHold"
  ADD CONSTRAINT "WallObservedHold_matchedVariantId_fkey"
  FOREIGN KEY ("matchedVariantId") REFERENCES "HoldVariant"("id")
  ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "WallObservedHoldAnchor"
  ADD CONSTRAINT "WallObservedHoldAnchor_observedHoldId_fkey"
  FOREIGN KEY ("observedHoldId") REFERENCES "WallObservedHold"("id")
  ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "WallObservedHoldAnchor"
  ADD CONSTRAINT "WallObservedHoldAnchor_wallHoleId_fkey"
  FOREIGN KEY ("wallHoleId") REFERENCES "WallHole"("id")
  ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "WallSettingJobSegment"
  ADD CONSTRAINT "WallSettingJobSegment_settingJobId_fkey"
  FOREIGN KEY ("settingJobId") REFERENCES "WallSettingJob"("id")
  ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "WallSettingJobSegment"
  ADD CONSTRAINT "WallSettingJobSegment_wallSegmentId_fkey"
  FOREIGN KEY ("wallSegmentId") REFERENCES "WallSegment"("id")
  ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "WallSettingJobSegment"
  ADD CONSTRAINT "WallSettingJobSegment_geometryVersionId_fkey"
  FOREIGN KEY ("geometryVersionId") REFERENCES "WallGeometryVersion"("id")
  ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "RouteVersionWallSegment"
  ADD CONSTRAINT "RouteVersionWallSegment_organizationId_fkey"
  FOREIGN KEY ("organizationId") REFERENCES "Organization"("id")
  ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "RouteVersionWallSegment"
  ADD CONSTRAINT "RouteVersionWallSegment_routeVersionId_fkey"
  FOREIGN KEY ("routeVersionId") REFERENCES "RouteVersion"("id")
  ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "RouteVersionWallSegment"
  ADD CONSTRAINT "RouteVersionWallSegment_wallSegmentId_fkey"
  FOREIGN KEY ("wallSegmentId") REFERENCES "WallSegment"("id")
  ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "RouteVersionWallSegment"
  ADD CONSTRAINT "RouteVersionWallSegment_geometryVersionId_fkey"
  FOREIGN KEY ("geometryVersionId") REFERENCES "WallGeometryVersion"("id")
  ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "RouteHoldPlacementAnchor"
  ADD CONSTRAINT "RouteHoldPlacementAnchor_organizationId_fkey"
  FOREIGN KEY ("organizationId") REFERENCES "Organization"("id")
  ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "RouteHoldPlacementAnchor"
  ADD CONSTRAINT "RouteHoldPlacementAnchor_placementId_fkey"
  FOREIGN KEY ("placementId") REFERENCES "RouteHoldPlacement"("id")
  ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "RouteHoldPlacementAnchor"
  ADD CONSTRAINT "RouteHoldPlacementAnchor_wallHoleId_fkey"
  FOREIGN KEY ("wallHoleId") REFERENCES "WallHole"("id")
  ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "HoldInstallation"
  ADD CONSTRAINT "HoldInstallation_organizationId_fkey"
  FOREIGN KEY ("organizationId") REFERENCES "Organization"("id")
  ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "HoldInstallation"
  ADD CONSTRAINT "HoldInstallation_holdVariantId_fkey"
  FOREIGN KEY ("holdVariantId") REFERENCES "HoldVariant"("id")
  ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "HoldInstallation"
  ADD CONSTRAINT "HoldInstallation_routeVersionId_fkey"
  FOREIGN KEY ("routeVersionId") REFERENCES "RouteVersion"("id")
  ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "HoldInstallation"
  ADD CONSTRAINT "HoldInstallation_routeHoldPlacementId_fkey"
  FOREIGN KEY ("routeHoldPlacementId") REFERENCES "RouteHoldPlacement"("id")
  ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "HoldInstallation"
  ADD CONSTRAINT "HoldInstallation_settingJobId_fkey"
  FOREIGN KEY ("settingJobId") REFERENCES "WallSettingJob"("id")
  ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "HoldInstallation"
  ADD CONSTRAINT "HoldInstallation_observedHoldId_fkey"
  FOREIGN KEY ("observedHoldId") REFERENCES "WallObservedHold"("id")
  ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "HoldInstallation"
  ADD CONSTRAINT "HoldInstallation_installedByAccountId_fkey"
  FOREIGN KEY ("installedByAccountId") REFERENCES "Account"("id")
  ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "HoldInstallation"
  ADD CONSTRAINT "HoldInstallation_removedByAccountId_fkey"
  FOREIGN KEY ("removedByAccountId") REFERENCES "Account"("id")
  ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "HoldInstallationAnchor"
  ADD CONSTRAINT "HoldInstallationAnchor_organizationId_fkey"
  FOREIGN KEY ("organizationId") REFERENCES "Organization"("id")
  ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "HoldInstallationAnchor"
  ADD CONSTRAINT "HoldInstallationAnchor_installationId_fkey"
  FOREIGN KEY ("installationId") REFERENCES "HoldInstallation"("id")
  ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "HoldInstallationAnchor"
  ADD CONSTRAINT "HoldInstallationAnchor_wallHoleId_fkey"
  FOREIGN KEY ("wallHoleId") REFERENCES "WallHole"("id")
  ON DELETE RESTRICT ON UPDATE CASCADE;
