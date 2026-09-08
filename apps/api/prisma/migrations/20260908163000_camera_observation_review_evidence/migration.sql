CREATE TYPE "CameraObservationReviewStatus" AS ENUM ('UNREVIEWED', 'CONFIRMED', 'OVERRIDDEN', 'INVALIDATED');

CREATE TYPE "CameraObservationReviewDecision" AS ENUM ('CONFIRM', 'OVERRIDE_COMPLETED', 'OVERRIDE_FAILED', 'INVALIDATE');

CREATE TYPE "CameraObservationEvidenceStatus" AS ENUM ('AVAILABLE', 'EXPIRED');

ALTER TABLE "ClimbObservation"
ADD COLUMN "reviewStatus" "CameraObservationReviewStatus" NOT NULL DEFAULT 'UNREVIEWED';

CREATE TABLE "CameraObservationReview" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "observationId" TEXT NOT NULL,
    "decision" "CameraObservationReviewDecision" NOT NULL,
    "finalOutcome" "ClimbObservationOutcome",
    "comment" TEXT,
    "reviewedByAccountId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "CameraObservationReview_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "CameraObservationEvidence" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "observationId" TEXT NOT NULL,
    "objectKey" TEXT NOT NULL,
    "contentType" TEXT NOT NULL,
    "sizeBytes" INTEGER NOT NULL,
    "checksumSha256" TEXT NOT NULL,
    "durationMs" INTEGER NOT NULL,
    "status" "CameraObservationEvidenceStatus" NOT NULL DEFAULT 'AVAILABLE',
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "expiredAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "CameraObservationEvidence_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "ClimbObservation_organizationId_reviewStatus_observedAt_idx"
ON "ClimbObservation"("organizationId", "reviewStatus", "observedAt");

CREATE INDEX "CameraObservationReview_organizationId_createdAt_idx"
ON "CameraObservationReview"("organizationId", "createdAt");

CREATE INDEX "CameraObservationReview_observationId_createdAt_idx"
ON "CameraObservationReview"("observationId", "createdAt");

CREATE UNIQUE INDEX "CameraObservationEvidence_observationId_key"
ON "CameraObservationEvidence"("observationId");

CREATE UNIQUE INDEX "CameraObservationEvidence_objectKey_key"
ON "CameraObservationEvidence"("objectKey");

CREATE INDEX "CameraObservationEvidence_organizationId_expiresAt_idx"
ON "CameraObservationEvidence"("organizationId", "expiresAt");

CREATE INDEX "CameraObservationEvidence_status_expiresAt_idx"
ON "CameraObservationEvidence"("status", "expiresAt");

ALTER TABLE "CameraObservationReview"
ADD CONSTRAINT "CameraObservationReview_organizationId_fkey"
FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "CameraObservationReview"
ADD CONSTRAINT "CameraObservationReview_observationId_fkey"
FOREIGN KEY ("observationId") REFERENCES "ClimbObservation"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "CameraObservationReview"
ADD CONSTRAINT "CameraObservationReview_reviewedByAccountId_fkey"
FOREIGN KEY ("reviewedByAccountId") REFERENCES "Account"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "CameraObservationEvidence"
ADD CONSTRAINT "CameraObservationEvidence_organizationId_fkey"
FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "CameraObservationEvidence"
ADD CONSTRAINT "CameraObservationEvidence_observationId_fkey"
FOREIGN KEY ("observationId") REFERENCES "ClimbObservation"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
