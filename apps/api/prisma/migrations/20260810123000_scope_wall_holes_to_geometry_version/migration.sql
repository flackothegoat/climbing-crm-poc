-- Hole identifiers and grid coordinates repeat legitimately across geometry versions.
DROP INDEX "WallHole_wallSegmentId_code_key";
DROP INDEX "WallHole_wallSegmentId_column_row_key";

CREATE UNIQUE INDEX "WallHole_geometryVersionId_code_key"
  ON "WallHole"("geometryVersionId", "code");
CREATE UNIQUE INDEX "WallHole_geometryVersionId_column_row_key"
  ON "WallHole"("geometryVersionId", "column", "row");
