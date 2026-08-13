-- All legacy holes were backfilled before new write paths were switched to dual-write.
ALTER TABLE "WallHole" ALTER COLUMN "geometryVersionId" SET NOT NULL;
