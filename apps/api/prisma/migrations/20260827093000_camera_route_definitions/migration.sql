CREATE TABLE "CameraRouteDefinition" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "cameraKey" TEXT NOT NULL,
    "wallSegmentId" TEXT NOT NULL,
    "routeId" TEXT NOT NULL,
    "routeVersionId" TEXT NOT NULL,
    "revision" INTEGER NOT NULL DEFAULT 1,
    "roiX1" DOUBLE PRECISION NOT NULL,
    "roiY1" DOUBLE PRECISION NOT NULL,
    "roiX2" DOUBLE PRECISION NOT NULL,
    "roiY2" DOUBLE PRECISION NOT NULL,
    "referenceWidth" INTEGER NOT NULL,
    "referenceHeight" INTEGER NOT NULL,
    "holds" JSONB NOT NULL,
    "startHoldIds" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
    "finishHoldIds" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
    "createdByAccountId" TEXT NOT NULL,
    "updatedByAccountId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "CameraRouteDefinition_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "CameraRouteDefinition_organizationId_cameraKey_routeVersionId_key"
ON "CameraRouteDefinition"("organizationId", "cameraKey", "routeVersionId");

CREATE INDEX "CameraRouteDefinition_organizationId_cameraKey_updatedAt_idx"
ON "CameraRouteDefinition"("organizationId", "cameraKey", "updatedAt");

CREATE INDEX "CameraRouteDefinition_wallSegmentId_idx"
ON "CameraRouteDefinition"("wallSegmentId");

CREATE INDEX "CameraRouteDefinition_routeId_idx"
ON "CameraRouteDefinition"("routeId");

CREATE INDEX "CameraRouteDefinition_routeVersionId_idx"
ON "CameraRouteDefinition"("routeVersionId");

ALTER TABLE "CameraRouteDefinition"
ADD CONSTRAINT "CameraRouteDefinition_organizationId_fkey"
FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "CameraRouteDefinition"
ADD CONSTRAINT "CameraRouteDefinition_wallSegmentId_fkey"
FOREIGN KEY ("wallSegmentId") REFERENCES "WallSegment"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "CameraRouteDefinition"
ADD CONSTRAINT "CameraRouteDefinition_routeId_fkey"
FOREIGN KEY ("routeId") REFERENCES "Route"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "CameraRouteDefinition"
ADD CONSTRAINT "CameraRouteDefinition_routeVersionId_fkey"
FOREIGN KEY ("routeVersionId") REFERENCES "RouteVersion"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "CameraRouteDefinition"
ADD CONSTRAINT "CameraRouteDefinition_createdByAccountId_fkey"
FOREIGN KEY ("createdByAccountId") REFERENCES "Account"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "CameraRouteDefinition"
ADD CONSTRAINT "CameraRouteDefinition_updatedByAccountId_fkey"
FOREIGN KEY ("updatedByAccountId") REFERENCES "Account"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
