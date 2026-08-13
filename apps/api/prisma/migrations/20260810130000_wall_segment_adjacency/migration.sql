CREATE TABLE "WallSegmentAdjacency" (
  "id" TEXT NOT NULL,
  "organizationId" TEXT NOT NULL,
  "areaId" TEXT NOT NULL,
  "segmentAId" TEXT NOT NULL,
  "segmentBId" TEXT NOT NULL,
  "calibration" "WallCalibrationStatus" NOT NULL DEFAULT 'SURVEY_ESTIMATE',
  "metadata" JSONB,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "WallSegmentAdjacency_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "WallSegmentAdjacency_distinct_segments_check" CHECK ("segmentAId" <> "segmentBId"),
  CONSTRAINT "WallSegmentAdjacency_canonical_order_check" CHECK ("segmentAId" < "segmentBId")
);

CREATE UNIQUE INDEX "WallSegmentAdjacency_segmentAId_segmentBId_key"
  ON "WallSegmentAdjacency"("segmentAId", "segmentBId");
CREATE INDEX "WallSegmentAdjacency_organizationId_areaId_idx"
  ON "WallSegmentAdjacency"("organizationId", "areaId");
CREATE INDEX "WallSegmentAdjacency_segmentBId_idx"
  ON "WallSegmentAdjacency"("segmentBId");

-- Existing survey segments were supplied as the ordered W01-W15 perimeter chain.
WITH ordered_segments AS (
  SELECT
    segment."organizationId",
    segment."areaId",
    segment."id" AS "segmentId",
    LEAD(segment."id") OVER (
      PARTITION BY segment."organizationId", segment."areaId"
      ORDER BY segment."code"
    ) AS "nextSegmentId"
  FROM "WallSegment" AS segment
)
INSERT INTO "WallSegmentAdjacency" (
  "id",
  "organizationId",
  "areaId",
  "segmentAId",
  "segmentBId",
  "calibration",
  "metadata",
  "updatedAt"
)
SELECT
  'legacy-adjacency-' || LEAST("segmentId", "nextSegmentId") || '-' || GREATEST("segmentId", "nextSegmentId"),
  "organizationId",
  "areaId",
  LEAST("segmentId", "nextSegmentId"),
  GREATEST("segmentId", "nextSegmentId"),
  'SURVEY_ESTIMATE'::"WallCalibrationStatus",
  jsonb_build_object('source', 'LEGACY_CODE_ORDER'),
  CURRENT_TIMESTAMP
FROM ordered_segments
WHERE "nextSegmentId" IS NOT NULL;

ALTER TABLE "WallSegmentAdjacency"
  ADD CONSTRAINT "WallSegmentAdjacency_organizationId_fkey"
  FOREIGN KEY ("organizationId") REFERENCES "Organization"("id")
  ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "WallSegmentAdjacency"
  ADD CONSTRAINT "WallSegmentAdjacency_areaId_fkey"
  FOREIGN KEY ("areaId") REFERENCES "WallArea"("id")
  ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "WallSegmentAdjacency"
  ADD CONSTRAINT "WallSegmentAdjacency_segmentAId_fkey"
  FOREIGN KEY ("segmentAId") REFERENCES "WallSegment"("id")
  ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "WallSegmentAdjacency"
  ADD CONSTRAINT "WallSegmentAdjacency_segmentBId_fkey"
  FOREIGN KEY ("segmentBId") REFERENCES "WallSegment"("id")
  ON DELETE RESTRICT ON UPDATE CASCADE;
