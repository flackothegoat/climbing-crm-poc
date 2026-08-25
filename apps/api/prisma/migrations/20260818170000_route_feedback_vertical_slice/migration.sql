-- First-stage vertical slice: operational route records, public QR links and member feedback.
-- Precise wall geometry remains optional so a route can be archived before 3D capture.

CREATE TYPE "RoutePublicLinkStatus" AS ENUM ('ACTIVE', 'REVOKED');
CREATE TYPE "RouteFeedbackOutcome" AS ENUM ('COMPLETED', 'ATTEMPTING');
CREATE TYPE "RouteDifficultyVote" AS ENUM ('EASIER', 'AS_EXPECTED', 'HARDER');
CREATE TYPE "RouteEnjoymentVote" AS ENUM ('DISLIKE', 'NEUTRAL', 'LIKE');

ALTER TABLE "Route"
  ADD COLUMN "description" TEXT,
  ADD COLUMN "expectedRetireAt" TIMESTAMP(3),
  ADD COLUMN "publishedAt" TIMESTAMP(3),
  ADD COLUMN "retiredAt" TIMESTAMP(3);

ALTER TABLE "RouteVersion"
  ADD COLUMN "displayColor" TEXT,
  ADD COLUMN "grade" TEXT,
  ADD COLUMN "gradeSystem" TEXT,
  ADD COLUMN "styleTags" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
  ADD COLUMN "setterMembershipId" TEXT,
  ADD COLUMN "publishedAt" TIMESTAMP(3),
  ADD COLUMN "retiredAt" TIMESTAMP(3);

UPDATE "RouteVersion" AS version
SET
  "displayColor" = route."displayColor",
  "grade" = route."grade",
  "gradeSystem" = CASE WHEN route."grade" ~ '^V[0-9]' THEN 'V' ELSE NULL END,
  "publishedAt" = CASE WHEN version."status" = 'PUBLISHED' THEN version."createdAt" ELSE NULL END,
  "retiredAt" = CASE WHEN version."status" = 'RETIRED' THEN version."updatedAt" ELSE NULL END
FROM "Route" AS route
WHERE route."id" = version."routeId";

UPDATE "Route"
SET
  "publishedAt" = CASE WHEN "status" = 'PUBLISHED' THEN "createdAt" ELSE NULL END,
  "retiredAt" = CASE WHEN "status" IN ('INACTIVE', 'REMOVED') THEN "updatedAt" ELSE NULL END;

ALTER TABLE "RouteVersionWallSegment" ALTER COLUMN "geometryVersionId" DROP NOT NULL;

CREATE TABLE "RoutePublicLink" (
  "id" TEXT NOT NULL,
  "organizationId" TEXT NOT NULL,
  "routeId" TEXT NOT NULL,
  "tokenHash" TEXT NOT NULL,
  "status" "RoutePublicLinkStatus" NOT NULL DEFAULT 'ACTIVE',
  "activeRouteKey" TEXT,
  "createdByAccountId" TEXT NOT NULL,
  "revokedAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "RoutePublicLink_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "RouteFeedback" (
  "id" TEXT NOT NULL,
  "organizationId" TEXT NOT NULL,
  "routeId" TEXT NOT NULL,
  "routeVersionId" TEXT NOT NULL,
  "publicLinkId" TEXT NOT NULL,
  "outcome" "RouteFeedbackOutcome" NOT NULL,
  "difficulty" "RouteDifficultyVote" NOT NULL,
  "enjoyment" "RouteEnjoymentVote" NOT NULL,
  "safetyConcern" BOOLEAN NOT NULL DEFAULT false,
  "comment" TEXT,
  "anonymousSessionKey" TEXT NOT NULL,
  "requestKey" TEXT NOT NULL,
  "submittedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "RouteFeedback_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "RoutePhoto" (
  "id" TEXT NOT NULL,
  "organizationId" TEXT NOT NULL,
  "routeVersionId" TEXT NOT NULL,
  "objectKey" TEXT NOT NULL,
  "originalFileName" TEXT NOT NULL,
  "contentType" TEXT NOT NULL,
  "sizeBytes" INTEGER NOT NULL,
  "checksumSha256" TEXT NOT NULL,
  "createdByAccountId" TEXT NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "RoutePhoto_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "RoutePublicLink_tokenHash_key" ON "RoutePublicLink"("tokenHash");
CREATE UNIQUE INDEX "RoutePublicLink_activeRouteKey_key" ON "RoutePublicLink"("activeRouteKey");
CREATE INDEX "RoutePublicLink_organizationId_status_idx" ON "RoutePublicLink"("organizationId", "status");
CREATE INDEX "RoutePublicLink_routeId_status_idx" ON "RoutePublicLink"("routeId", "status");

CREATE UNIQUE INDEX "RouteFeedback_organizationId_requestKey_key" ON "RouteFeedback"("organizationId", "requestKey");
CREATE INDEX "RouteFeedback_organizationId_submittedAt_idx" ON "RouteFeedback"("organizationId", "submittedAt");
CREATE INDEX "RouteFeedback_routeId_submittedAt_idx" ON "RouteFeedback"("routeId", "submittedAt");
CREATE INDEX "RouteFeedback_routeVersionId_submittedAt_idx" ON "RouteFeedback"("routeVersionId", "submittedAt");
CREATE INDEX "RouteFeedback_anonymousSessionKey_routeVersionId_submittedAt_idx"
  ON "RouteFeedback"("anonymousSessionKey", "routeVersionId", "submittedAt");

CREATE UNIQUE INDEX "RoutePhoto_routeVersionId_key" ON "RoutePhoto"("routeVersionId");
CREATE UNIQUE INDEX "RoutePhoto_objectKey_key" ON "RoutePhoto"("objectKey");
CREATE INDEX "RoutePhoto_organizationId_createdAt_idx" ON "RoutePhoto"("organizationId", "createdAt");
CREATE INDEX "RouteVersion_setterMembershipId_idx" ON "RouteVersion"("setterMembershipId");

ALTER TABLE "RouteVersion"
  ADD CONSTRAINT "RouteVersion_setterMembershipId_fkey"
  FOREIGN KEY ("setterMembershipId") REFERENCES "Membership"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "RoutePublicLink"
  ADD CONSTRAINT "RoutePublicLink_organizationId_fkey"
  FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  ADD CONSTRAINT "RoutePublicLink_routeId_fkey"
  FOREIGN KEY ("routeId") REFERENCES "Route"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  ADD CONSTRAINT "RoutePublicLink_createdByAccountId_fkey"
  FOREIGN KEY ("createdByAccountId") REFERENCES "Account"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "RouteFeedback"
  ADD CONSTRAINT "RouteFeedback_organizationId_fkey"
  FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  ADD CONSTRAINT "RouteFeedback_routeId_fkey"
  FOREIGN KEY ("routeId") REFERENCES "Route"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  ADD CONSTRAINT "RouteFeedback_routeVersionId_fkey"
  FOREIGN KEY ("routeVersionId") REFERENCES "RouteVersion"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  ADD CONSTRAINT "RouteFeedback_publicLinkId_fkey"
  FOREIGN KEY ("publicLinkId") REFERENCES "RoutePublicLink"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "RoutePhoto"
  ADD CONSTRAINT "RoutePhoto_organizationId_fkey"
  FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  ADD CONSTRAINT "RoutePhoto_routeVersionId_fkey"
  FOREIGN KEY ("routeVersionId") REFERENCES "RouteVersion"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  ADD CONSTRAINT "RoutePhoto_createdByAccountId_fkey"
  FOREIGN KEY ("createdByAccountId") REFERENCES "Account"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "Route"
  ADD CONSTRAINT "Route_lifecycle_dates_check" CHECK (
    "retiredAt" IS NULL OR "publishedAt" IS NULL OR "retiredAt" >= "publishedAt"
  );
ALTER TABLE "RouteVersion"
  ADD CONSTRAINT "RouteVersion_publication_dates_check" CHECK (
    "retiredAt" IS NULL OR "publishedAt" IS NULL OR "retiredAt" >= "publishedAt"
  );
ALTER TABLE "RoutePublicLink"
  ADD CONSTRAINT "RoutePublicLink_active_state_check" CHECK (
    ("status" = 'ACTIVE' AND "activeRouteKey" IS NOT NULL AND "revokedAt" IS NULL)
    OR ("status" = 'REVOKED' AND "activeRouteKey" IS NULL AND "revokedAt" IS NOT NULL)
  );
ALTER TABLE "RouteFeedback"
  ADD CONSTRAINT "RouteFeedback_comment_length_check" CHECK (
    "comment" IS NULL OR char_length("comment") <= 300
  );
ALTER TABLE "RoutePhoto"
  ADD CONSTRAINT "RoutePhoto_size_check" CHECK ("sizeBytes" > 0 AND "sizeBytes" <= 10485760);

-- The original scope trigger required every route wall assignment to have geometry.
-- Replace only that table's trigger and keep the existing guard for all other domain tables.
DROP TRIGGER "RouteVersionWallSegment_scope_guard" ON "RouteVersionWallSegment";

CREATE OR REPLACE FUNCTION "assert_route_operational_scope"() RETURNS trigger AS $$
BEGIN
  IF TG_TABLE_NAME = 'RouteVersionWallSegment' THEN
    IF NOT EXISTS (
      SELECT 1 FROM "RouteVersion" version
      JOIN "WallSegment" segment ON segment."id" = NEW."wallSegmentId"
      WHERE version."id" = NEW."routeVersionId"
        AND version."organizationId" = NEW."organizationId"
        AND segment."organizationId" = NEW."organizationId"
        AND (NEW."geometryVersionId" IS NULL OR EXISTS (
          SELECT 1 FROM "WallGeometryVersion" geometry
          WHERE geometry."id" = NEW."geometryVersionId"
            AND geometry."organizationId" = NEW."organizationId"
            AND geometry."wallSegmentId" = NEW."wallSegmentId"
        ))
    ) THEN RAISE EXCEPTION USING ERRCODE = '23514', MESSAGE = 'RouteVersionWallSegment operational scope mismatch'; END IF;

  ELSIF TG_TABLE_NAME = 'RouteVersion' THEN
    IF NEW."setterMembershipId" IS NOT NULL AND NOT EXISTS (
      SELECT 1 FROM "Membership" membership
      WHERE membership."id" = NEW."setterMembershipId"
        AND membership."organizationId" = NEW."organizationId"
        AND membership."status" = 'ACTIVE'
    ) THEN RAISE EXCEPTION USING ERRCODE = '23514', MESSAGE = 'RouteVersion setter/organization mismatch'; END IF;

  ELSIF TG_TABLE_NAME = 'RoutePublicLink' THEN
    IF NOT EXISTS (
      SELECT 1 FROM "Route" route
      JOIN "Membership" membership ON membership."accountId" = NEW."createdByAccountId"
      WHERE route."id" = NEW."routeId"
        AND route."organizationId" = NEW."organizationId"
        AND membership."organizationId" = NEW."organizationId"
    ) THEN RAISE EXCEPTION USING ERRCODE = '23514', MESSAGE = 'RoutePublicLink scope mismatch'; END IF;

  ELSIF TG_TABLE_NAME = 'RouteFeedback' THEN
    IF NOT EXISTS (
      SELECT 1 FROM "Route" route
      JOIN "RouteVersion" version ON version."id" = NEW."routeVersionId"
      JOIN "RoutePublicLink" link ON link."id" = NEW."publicLinkId"
      WHERE route."id" = NEW."routeId"
        AND route."organizationId" = NEW."organizationId"
        AND version."routeId" = NEW."routeId"
        AND version."organizationId" = NEW."organizationId"
        AND link."routeId" = NEW."routeId"
        AND link."organizationId" = NEW."organizationId"
    ) THEN RAISE EXCEPTION USING ERRCODE = '23514', MESSAGE = 'RouteFeedback scope mismatch'; END IF;

  ELSIF TG_TABLE_NAME = 'RoutePhoto' THEN
    IF NOT EXISTS (
      SELECT 1 FROM "RouteVersion" version
      JOIN "Membership" membership ON membership."accountId" = NEW."createdByAccountId"
      WHERE version."id" = NEW."routeVersionId"
        AND version."organizationId" = NEW."organizationId"
        AND membership."organizationId" = NEW."organizationId"
    ) THEN RAISE EXCEPTION USING ERRCODE = '23514', MESSAGE = 'RoutePhoto scope mismatch'; END IF;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER "RouteVersionWallSegment_operational_scope_guard"
  BEFORE INSERT OR UPDATE ON "RouteVersionWallSegment"
  FOR EACH ROW EXECUTE FUNCTION "assert_route_operational_scope"();
CREATE TRIGGER "RouteVersion_operational_scope_guard"
  BEFORE INSERT OR UPDATE ON "RouteVersion"
  FOR EACH ROW EXECUTE FUNCTION "assert_route_operational_scope"();
CREATE TRIGGER "RoutePublicLink_operational_scope_guard"
  BEFORE INSERT OR UPDATE ON "RoutePublicLink"
  FOR EACH ROW EXECUTE FUNCTION "assert_route_operational_scope"();
CREATE TRIGGER "RouteFeedback_operational_scope_guard"
  BEFORE INSERT OR UPDATE ON "RouteFeedback"
  FOR EACH ROW EXECUTE FUNCTION "assert_route_operational_scope"();
CREATE TRIGGER "RoutePhoto_operational_scope_guard"
  BEFORE INSERT OR UPDATE ON "RoutePhoto"
  FOR EACH ROW EXECUTE FUNCTION "assert_route_operational_scope"();
