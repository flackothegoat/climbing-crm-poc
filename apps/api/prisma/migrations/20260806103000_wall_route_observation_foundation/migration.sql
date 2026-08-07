-- CreateEnum
CREATE TYPE "WallStatus" AS ENUM ('ACTIVE', 'RETIRED');

-- CreateEnum
CREATE TYPE "WallCalibrationStatus" AS ENUM ('SURVEY_ESTIMATE', 'FIELD_CALIBRATED');

-- CreateEnum
CREATE TYPE "WallHoleStatus" AS ENUM ('AVAILABLE', 'MISSING', 'CLOSED', 'DAMAGED');

-- CreateEnum
CREATE TYPE "RouteStatus" AS ENUM ('DRAFT', 'READY_FOR_INSTALL', 'PUBLISHED', 'INACTIVE', 'REMOVED');

-- CreateEnum
CREATE TYPE "RouteVersionStatus" AS ENUM ('DRAFT', 'PUBLISHED', 'RETIRED');

-- CreateEnum
CREATE TYPE "RouteDataSource" AS ENUM ('DUMMY', 'MANUAL', 'IMPORTED');

-- CreateEnum
CREATE TYPE "RoutePlacementRole" AS ENUM ('START', 'NORMAL', 'FINISH');

-- CreateEnum
CREATE TYPE "ClimbObservationOutcome" AS ENUM ('COMPLETED', 'FAILED', 'ABANDONED', 'UNKNOWN');

-- CreateEnum
CREATE TYPE "ClimbObservationSource" AS ENUM ('DUMMY', 'MANUAL', 'CAMERA');

-- CreateTable
CREATE TABLE "WallArea" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "floorLabel" TEXT,
    "status" "WallStatus" NOT NULL DEFAULT 'ACTIVE',
    "calibration" "WallCalibrationStatus" NOT NULL DEFAULT 'SURVEY_ESTIMATE',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "WallArea_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "WallSegment" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "areaId" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "widthMm" INTEGER NOT NULL,
    "heightMm" INTEGER NOT NULL,
    "surfaceHeightMm" INTEGER,
    "angleFromVerticalDegrees" DOUBLE PRECISION,
    "horizontalPitchMm" INTEGER,
    "verticalPitchMm" INTEGER,
    "status" "WallStatus" NOT NULL DEFAULT 'ACTIVE',
    "calibration" "WallCalibrationStatus" NOT NULL DEFAULT 'SURVEY_ESTIMATE',
    "metadata" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "WallSegment_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "WallSegment_dimensions_check" CHECK ("widthMm" > 0 AND "heightMm" > 0),
    CONSTRAINT "WallSegment_surface_height_check" CHECK ("surfaceHeightMm" IS NULL OR "surfaceHeightMm" > 0),
    CONSTRAINT "WallSegment_angle_check" CHECK ("angleFromVerticalDegrees" IS NULL OR "angleFromVerticalDegrees" BETWEEN -180 AND 180),
    CONSTRAINT "WallSegment_pitch_check" CHECK (("horizontalPitchMm" IS NULL OR "horizontalPitchMm" > 0) AND ("verticalPitchMm" IS NULL OR "verticalPitchMm" > 0))
);

-- CreateTable
CREATE TABLE "WallHole" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "wallSegmentId" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "column" INTEGER NOT NULL,
    "row" INTEGER NOT NULL,
    "uMm" INTEGER NOT NULL,
    "vMm" INTEGER NOT NULL,
    "status" "WallHoleStatus" NOT NULL DEFAULT 'AVAILABLE',
    "calibration" "WallCalibrationStatus" NOT NULL DEFAULT 'SURVEY_ESTIMATE',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "WallHole_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "WallHole_grid_check" CHECK ("column" >= 0 AND "row" >= 0)
);

-- CreateTable
CREATE TABLE "Route" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "wallSegmentId" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "displayColor" TEXT NOT NULL,
    "grade" TEXT NOT NULL,
    "status" "RouteStatus" NOT NULL DEFAULT 'DRAFT',
    "dataSource" "RouteDataSource" NOT NULL DEFAULT 'MANUAL',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "Route_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "RouteVersion" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "routeId" TEXT NOT NULL,
    "versionNumber" INTEGER NOT NULL,
    "status" "RouteVersionStatus" NOT NULL DEFAULT 'DRAFT',
    "dataSource" "RouteDataSource" NOT NULL DEFAULT 'MANUAL',
    "note" TEXT,
    "createdByAccountId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "RouteVersion_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "RouteVersion_number_check" CHECK ("versionNumber" > 0)
);

-- CreateTable
CREATE TABLE "RouteHoldPlacement" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "routeVersionId" TEXT NOT NULL,
    "wallHoleId" TEXT NOT NULL,
    "holdVariantId" TEXT,
    "demoAssetKey" TEXT,
    "role" "RoutePlacementRole" NOT NULL DEFAULT 'NORMAL',
    "rotationDegrees" INTEGER NOT NULL,
    "dataSource" "RouteDataSource" NOT NULL DEFAULT 'MANUAL',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "RouteHoldPlacement_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "RouteHoldPlacement_rotation_check" CHECK ("rotationDegrees" BETWEEN -180 AND 180),
    CONSTRAINT "RouteHoldPlacement_asset_check" CHECK (
      ("dataSource" = 'DUMMY' AND "demoAssetKey" IS NOT NULL)
      OR ("dataSource" <> 'DUMMY' AND "holdVariantId" IS NOT NULL)
    )
);

-- CreateTable
CREATE TABLE "ClimbObservation" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "wallSegmentId" TEXT NOT NULL,
    "routeId" TEXT NOT NULL,
    "routeVersionId" TEXT,
    "outcome" "ClimbObservationOutcome" NOT NULL,
    "source" "ClimbObservationSource" NOT NULL,
    "observedAt" TIMESTAMP(3) NOT NULL,
    "climberKey" TEXT,
    "requestKey" TEXT,
    "correctsObservationId" TEXT,
    "createdByAccountId" TEXT,
    "metadata" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "ClimbObservation_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "ClimbObservation_manual_actor_check" CHECK ("source" <> 'MANUAL' OR "createdByAccountId" IS NOT NULL),
    CONSTRAINT "ClimbObservation_correction_check" CHECK ("correctsObservationId" IS NULL OR "correctsObservationId" <> "id")
);

-- CreateIndex
CREATE UNIQUE INDEX "WallArea_organizationId_code_key" ON "WallArea"("organizationId", "code");
CREATE INDEX "WallArea_organizationId_status_updatedAt_idx" ON "WallArea"("organizationId", "status", "updatedAt");
CREATE UNIQUE INDEX "WallSegment_organizationId_code_key" ON "WallSegment"("organizationId", "code");
CREATE INDEX "WallSegment_areaId_status_idx" ON "WallSegment"("areaId", "status");
CREATE INDEX "WallSegment_organizationId_status_updatedAt_idx" ON "WallSegment"("organizationId", "status", "updatedAt");
CREATE UNIQUE INDEX "WallHole_wallSegmentId_code_key" ON "WallHole"("wallSegmentId", "code");
CREATE UNIQUE INDEX "WallHole_wallSegmentId_column_row_key" ON "WallHole"("wallSegmentId", "column", "row");
CREATE INDEX "WallHole_organizationId_wallSegmentId_idx" ON "WallHole"("organizationId", "wallSegmentId");
CREATE UNIQUE INDEX "Route_organizationId_code_key" ON "Route"("organizationId", "code");
CREATE INDEX "Route_wallSegmentId_status_idx" ON "Route"("wallSegmentId", "status");
CREATE INDEX "Route_organizationId_status_updatedAt_idx" ON "Route"("organizationId", "status", "updatedAt");
CREATE UNIQUE INDEX "RouteVersion_routeId_versionNumber_key" ON "RouteVersion"("routeId", "versionNumber");
CREATE INDEX "RouteVersion_organizationId_status_updatedAt_idx" ON "RouteVersion"("organizationId", "status", "updatedAt");
CREATE UNIQUE INDEX "RouteHoldPlacement_routeVersionId_wallHoleId_key" ON "RouteHoldPlacement"("routeVersionId", "wallHoleId");
CREATE INDEX "RouteHoldPlacement_organizationId_routeVersionId_idx" ON "RouteHoldPlacement"("organizationId", "routeVersionId");
CREATE INDEX "RouteHoldPlacement_holdVariantId_idx" ON "RouteHoldPlacement"("holdVariantId");
CREATE INDEX "RouteHoldPlacement_wallHoleId_idx" ON "RouteHoldPlacement"("wallHoleId");
CREATE UNIQUE INDEX "ClimbObservation_organizationId_requestKey_key" ON "ClimbObservation"("organizationId", "requestKey");
CREATE INDEX "ClimbObservation_organizationId_observedAt_idx" ON "ClimbObservation"("organizationId", "observedAt");
CREATE INDEX "ClimbObservation_wallSegmentId_observedAt_idx" ON "ClimbObservation"("wallSegmentId", "observedAt");
CREATE INDEX "ClimbObservation_routeId_observedAt_idx" ON "ClimbObservation"("routeId", "observedAt");

-- AddForeignKey
ALTER TABLE "WallArea" ADD CONSTRAINT "WallArea_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "WallSegment" ADD CONSTRAINT "WallSegment_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "WallSegment" ADD CONSTRAINT "WallSegment_areaId_fkey" FOREIGN KEY ("areaId") REFERENCES "WallArea"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "WallHole" ADD CONSTRAINT "WallHole_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "WallHole" ADD CONSTRAINT "WallHole_wallSegmentId_fkey" FOREIGN KEY ("wallSegmentId") REFERENCES "WallSegment"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "Route" ADD CONSTRAINT "Route_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "Route" ADD CONSTRAINT "Route_wallSegmentId_fkey" FOREIGN KEY ("wallSegmentId") REFERENCES "WallSegment"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "RouteVersion" ADD CONSTRAINT "RouteVersion_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "RouteVersion" ADD CONSTRAINT "RouteVersion_routeId_fkey" FOREIGN KEY ("routeId") REFERENCES "Route"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "RouteVersion" ADD CONSTRAINT "RouteVersion_createdByAccountId_fkey" FOREIGN KEY ("createdByAccountId") REFERENCES "Account"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "RouteHoldPlacement" ADD CONSTRAINT "RouteHoldPlacement_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "RouteHoldPlacement" ADD CONSTRAINT "RouteHoldPlacement_routeVersionId_fkey" FOREIGN KEY ("routeVersionId") REFERENCES "RouteVersion"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "RouteHoldPlacement" ADD CONSTRAINT "RouteHoldPlacement_wallHoleId_fkey" FOREIGN KEY ("wallHoleId") REFERENCES "WallHole"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "RouteHoldPlacement" ADD CONSTRAINT "RouteHoldPlacement_holdVariantId_fkey" FOREIGN KEY ("holdVariantId") REFERENCES "HoldVariant"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "ClimbObservation" ADD CONSTRAINT "ClimbObservation_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "ClimbObservation" ADD CONSTRAINT "ClimbObservation_wallSegmentId_fkey" FOREIGN KEY ("wallSegmentId") REFERENCES "WallSegment"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "ClimbObservation" ADD CONSTRAINT "ClimbObservation_routeId_fkey" FOREIGN KEY ("routeId") REFERENCES "Route"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "ClimbObservation" ADD CONSTRAINT "ClimbObservation_routeVersionId_fkey" FOREIGN KEY ("routeVersionId") REFERENCES "RouteVersion"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "ClimbObservation" ADD CONSTRAINT "ClimbObservation_correctsObservationId_fkey" FOREIGN KEY ("correctsObservationId") REFERENCES "ClimbObservation"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "ClimbObservation" ADD CONSTRAINT "ClimbObservation_createdByAccountId_fkey" FOREIGN KEY ("createdByAccountId") REFERENCES "Account"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
