-- Backend hardening: remove redundant identity/geometry ownership fields,
-- make route observations version-specific, add optimistic plan revisions,
-- request correlation and durable object cleanup jobs.

DO $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM "AuthSession" AS session
    JOIN "Membership" AS membership ON membership."id" = session."membershipId"
    WHERE membership."accountId" <> session."accountId"
  ) THEN
    RAISE EXCEPTION 'Cannot remove AuthSession.accountId: mismatched membership sessions exist';
  END IF;
END $$;

ALTER TABLE "WallSegment" ADD COLUMN "routePlanRevision" INTEGER NOT NULL DEFAULT 0;

ALTER TABLE "HoldInstallation"
  ADD COLUMN "installRequestKey" TEXT,
  ADD COLUMN "removeRequestKey" TEXT;
UPDATE "HoldInstallation"
SET "installRequestKey" = 'legacy-installation-' || "id"
WHERE "installRequestKey" IS NULL;
ALTER TABLE "HoldInstallation" ALTER COLUMN "installRequestKey" SET NOT NULL;
CREATE UNIQUE INDEX "HoldInstallation_organizationId_installRequestKey_key"
  ON "HoldInstallation"("organizationId", "installRequestKey");
CREATE UNIQUE INDEX "HoldInstallation_organizationId_removeRequestKey_key"
  ON "HoldInstallation"("organizationId", "removeRequestKey");

ALTER TABLE "WallGeometryVersion"
  ADD COLUMN "horizontalPitchMm" INTEGER,
  ADD COLUMN "verticalPitchMm" INTEGER;

UPDATE "WallGeometryVersion" AS geometry
SET
  "horizontalPitchMm" = segment."horizontalPitchMm",
  "verticalPitchMm" = segment."verticalPitchMm"
FROM "WallSegment" AS segment
WHERE segment."id" = geometry."wallSegmentId";

ALTER TABLE "WallGeometryVersion"
  ADD CONSTRAINT "WallGeometryVersion_pitch_check" CHECK (
    ("horizontalPitchMm" IS NULL OR "horizontalPitchMm" > 0)
    AND ("verticalPitchMm" IS NULL OR "verticalPitchMm" > 0)
  );

UPDATE "ClimbObservation" AS observation
SET "routeVersionId" = (
  SELECT version."id"
  FROM "RouteVersion" AS version
  WHERE version."routeId" = observation."routeId"
  ORDER BY
    CASE version."status" WHEN 'PUBLISHED' THEN 0 WHEN 'DRAFT' THEN 1 ELSE 2 END,
    version."versionNumber" DESC
  LIMIT 1
)
WHERE observation."routeVersionId" IS NULL;

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM "ClimbObservation" WHERE "routeVersionId" IS NULL) THEN
    RAISE EXCEPTION 'Cannot require ClimbObservation.routeVersionId: observations without a route version exist';
  END IF;
END $$;

ALTER TABLE "ClimbObservation" ALTER COLUMN "routeVersionId" SET NOT NULL;
ALTER TABLE "ClimbObservation" ALTER COLUMN "wallSegmentId" DROP NOT NULL;

ALTER TABLE "AuditEvent" ADD COLUMN "correlationId" TEXT;
CREATE INDEX "AuditEvent_correlationId_idx" ON "AuditEvent"("correlationId");

CREATE TYPE "ObjectCleanupStatus" AS ENUM ('PENDING', 'COMPLETED', 'FAILED');
CREATE TABLE "ObjectCleanupJob" (
  "id" TEXT NOT NULL,
  "objectKey" TEXT NOT NULL,
  "reason" TEXT NOT NULL,
  "status" "ObjectCleanupStatus" NOT NULL DEFAULT 'PENDING',
  "attemptCount" INTEGER NOT NULL DEFAULT 0,
  "lastError" TEXT,
  "nextAttemptAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "completedAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "ObjectCleanupJob_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "ObjectCleanupJob_attempt_count_check" CHECK ("attemptCount" >= 0)
);
CREATE UNIQUE INDEX "ObjectCleanupJob_objectKey_key" ON "ObjectCleanupJob"("objectKey");
CREATE INDEX "ObjectCleanupJob_status_nextAttemptAt_idx"
  ON "ObjectCleanupJob"("status", "nextAttemptAt");

-- Fix historical Prisma drift; @updatedAt does not declare a database default.
ALTER TABLE "Membership" ALTER COLUMN "updatedAt" DROP DEFAULT;

-- Session identity is now derived exclusively from Membership.
ALTER TABLE "AuthSession" DROP CONSTRAINT "AuthSession_accountId_fkey";
DROP INDEX "AuthSession_accountId_expiresAt_idx";
ALTER TABLE "AuthSession" DROP COLUMN "accountId";

-- Route-to-wall ownership is now exclusively versioned by RouteVersionWallSegment.
ALTER TABLE "Route" DROP CONSTRAINT "Route_wallSegmentId_fkey";
DROP INDEX "Route_wallSegmentId_status_idx";
ALTER TABLE "Route" DROP COLUMN "wallSegmentId";

-- Geometry belongs exclusively to WallGeometryVersion.
ALTER TABLE "WallSegment" DROP CONSTRAINT "WallSegment_dimensions_check";
ALTER TABLE "WallSegment" DROP CONSTRAINT "WallSegment_surface_height_check";
ALTER TABLE "WallSegment" DROP CONSTRAINT "WallSegment_angle_check";
ALTER TABLE "WallSegment" DROP CONSTRAINT "WallSegment_pitch_check";
ALTER TABLE "WallSegment"
  DROP COLUMN "widthMm",
  DROP COLUMN "heightMm",
  DROP COLUMN "surfaceHeightMm",
  DROP COLUMN "angleFromVerticalDegrees",
  DROP COLUMN "horizontalPitchMm",
  DROP COLUMN "verticalPitchMm",
  DROP COLUMN "calibration";
