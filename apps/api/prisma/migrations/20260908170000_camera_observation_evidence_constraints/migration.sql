ALTER TABLE "CameraObservationReview"
ADD CONSTRAINT "CameraObservationReview_decision_check" CHECK (
  ("decision" = 'CONFIRM' AND "finalOutcome" IS NOT NULL)
  OR ("decision" = 'OVERRIDE_COMPLETED' AND "finalOutcome" = 'COMPLETED')
  OR ("decision" = 'OVERRIDE_FAILED' AND "finalOutcome" = 'FAILED')
  OR ("decision" = 'INVALIDATE' AND "finalOutcome" IS NULL)
);

ALTER TABLE "CameraObservationEvidence"
ADD CONSTRAINT "CameraObservationEvidence_size_duration_check" CHECK (
  "sizeBytes" > 0 AND "durationMs" > 0
);

ALTER TABLE "CameraObservationEvidence"
ADD CONSTRAINT "CameraObservationEvidence_status_check" CHECK (
  ("status" = 'AVAILABLE' AND "expiredAt" IS NULL)
  OR ("status" = 'EXPIRED' AND "expiredAt" IS NOT NULL)
);
