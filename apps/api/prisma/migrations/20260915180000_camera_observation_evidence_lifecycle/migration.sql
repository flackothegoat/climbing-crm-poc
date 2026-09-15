CREATE TYPE "CameraObservationEvidenceState" AS ENUM (
  'NOT_RECORDED',
  'PENDING',
  'AVAILABLE',
  'FAILED',
  'EXPIRED'
);

ALTER TABLE "ClimbObservation"
ADD COLUMN "evidenceState" "CameraObservationEvidenceState" NOT NULL DEFAULT 'NOT_RECORDED';

UPDATE "ClimbObservation" AS observation
SET "evidenceState" = CASE
  WHEN evidence.status = 'AVAILABLE' THEN 'AVAILABLE'::"CameraObservationEvidenceState"
  WHEN evidence.status = 'EXPIRED' THEN 'EXPIRED'::"CameraObservationEvidenceState"
  ELSE 'NOT_RECORDED'::"CameraObservationEvidenceState"
END
FROM "CameraObservationEvidence" AS evidence
WHERE evidence."observationId" = observation.id;
