import { config as loadDotenv } from 'dotenv';
import { resolve } from 'node:path';
import { PrismaService } from '../src/database/prisma.service';

loadDotenv({ path: resolve(process.cwd(), '../../.env') });

const checks = {
  wallHoleScopeMismatch: `
    SELECT COUNT(*)::int AS count
    FROM "WallHole" hole
    JOIN "WallGeometryVersion" geometry ON geometry."id" = hole."geometryVersionId"
    WHERE geometry."organizationId" <> hole."organizationId"
       OR geometry."wallSegmentId" <> hole."wallSegmentId"
  `,
  adjacencyScopeMismatch: `
    SELECT COUNT(*)::int AS count
    FROM "WallSegmentAdjacency" adjacency
    JOIN "WallArea" area ON area."id" = adjacency."areaId"
    JOIN "WallSegment" a ON a."id" = adjacency."segmentAId"
    JOIN "WallSegment" b ON b."id" = adjacency."segmentBId"
    WHERE area."organizationId" <> adjacency."organizationId"
       OR a."organizationId" <> adjacency."organizationId"
       OR b."organizationId" <> adjacency."organizationId"
       OR a."areaId" <> adjacency."areaId"
       OR b."areaId" <> adjacency."areaId"
  `,
  routeVersionScopeMismatch: `
    SELECT COUNT(*)::int AS count
    FROM "RouteVersion" version
    JOIN "Route" route ON route."id" = version."routeId"
    LEFT JOIN "Membership" setter ON setter."id" = version."setterMembershipId"
    WHERE route."organizationId" <> version."organizationId"
       OR (version."setterMembershipId" IS NOT NULL AND (
         setter."id" IS NULL OR setter."organizationId" <> version."organizationId"
       ))
  `,
  routeSegmentScopeMismatch: `
    SELECT COUNT(*)::int AS count
    FROM "RouteVersionWallSegment" scope
    JOIN "RouteVersion" version ON version."id" = scope."routeVersionId"
    JOIN "WallSegment" segment ON segment."id" = scope."wallSegmentId"
    LEFT JOIN "WallGeometryVersion" geometry ON geometry."id" = scope."geometryVersionId"
    WHERE version."organizationId" <> scope."organizationId"
       OR segment."organizationId" <> scope."organizationId"
       OR (scope."geometryVersionId" IS NOT NULL AND (
         geometry."id" IS NULL
         OR geometry."organizationId" <> scope."organizationId"
         OR geometry."wallSegmentId" <> scope."wallSegmentId"
       ))
  `,
  routePublicLinkScopeMismatch: `
    SELECT COUNT(*)::int AS count
    FROM "RoutePublicLink" link
    JOIN "Route" route ON route."id" = link."routeId"
    WHERE route."organizationId" <> link."organizationId"
       OR NOT EXISTS (
         SELECT 1 FROM "Membership" membership
         WHERE membership."accountId" = link."createdByAccountId"
           AND membership."organizationId" = link."organizationId"
       )
       OR (link."status" = 'ACTIVE' AND (
         link."activeRouteKey" IS NULL OR link."revokedAt" IS NOT NULL
       ))
       OR (link."status" = 'REVOKED' AND (
         link."activeRouteKey" IS NOT NULL OR link."revokedAt" IS NULL
       ))
  `,
  routeFeedbackScopeMismatch: `
    SELECT COUNT(*)::int AS count
    FROM "RouteFeedback" feedback
    JOIN "Route" route ON route."id" = feedback."routeId"
    JOIN "RouteVersion" version ON version."id" = feedback."routeVersionId"
    JOIN "RoutePublicLink" link ON link."id" = feedback."publicLinkId"
    WHERE route."organizationId" <> feedback."organizationId"
       OR version."organizationId" <> feedback."organizationId"
       OR version."routeId" <> feedback."routeId"
       OR link."organizationId" <> feedback."organizationId"
       OR link."routeId" <> feedback."routeId"
  `,
  routePhotoScopeMismatch: `
    SELECT COUNT(*)::int AS count
    FROM "RoutePhoto" photo
    JOIN "RouteVersion" version ON version."id" = photo."routeVersionId"
    WHERE version."organizationId" <> photo."organizationId"
       OR NOT EXISTS (
         SELECT 1 FROM "Membership" membership
         WHERE membership."accountId" = photo."createdByAccountId"
           AND membership."organizationId" = photo."organizationId"
       )
  `,
  routeVisualAnnotationScopeMismatch: `
    SELECT COUNT(*)::int AS count
    FROM "RouteVisualAnnotation" annotation
    JOIN "RouteVersion" version ON version."id" = annotation."routeVersionId"
    WHERE version."organizationId" <> annotation."organizationId"
       OR NOT EXISTS (
         SELECT 1 FROM "Membership" membership
         WHERE membership."accountId" = annotation."createdByAccountId"
           AND membership."organizationId" = annotation."organizationId"
       )
       OR (annotation."confirmedByAccountId" IS NOT NULL AND NOT EXISTS (
         SELECT 1 FROM "Membership" membership
         WHERE membership."accountId" = annotation."confirmedByAccountId"
           AND membership."organizationId" = annotation."organizationId"
       ))
       OR (annotation."status" = 'CONFIRMED' AND annotation."activeRouteVersionKey" <> annotation."routeVersionId")
  `,
  routeVisualPointScopeMismatch: `
    SELECT COUNT(*)::int AS count
    FROM "RouteVisualPoint" point
    JOIN "RouteVisualAnnotation" annotation ON annotation."id" = point."annotationId"
    JOIN "WallSegment" segment ON segment."id" = point."wallSegmentId"
    WHERE annotation."organizationId" <> point."organizationId"
       OR segment."organizationId" <> point."organizationId"
       OR NOT EXISTS (
         SELECT 1 FROM "RouteVersionWallSegment" scope
         WHERE scope."routeVersionId" = annotation."routeVersionId"
           AND scope."wallSegmentId" = point."wallSegmentId"
           AND scope."organizationId" = point."organizationId"
       )
  `,
  cameraRouteDefinitionScopeMismatch: `
    SELECT COUNT(*)::int AS count
    FROM "CameraRouteDefinition" definition
    JOIN "Route" route ON route."id" = definition."routeId"
    JOIN "RouteVersion" version ON version."id" = definition."routeVersionId"
    JOIN "WallSegment" segment ON segment."id" = definition."wallSegmentId"
    WHERE route."organizationId" <> definition."organizationId"
       OR version."organizationId" <> definition."organizationId"
       OR version."routeId" <> definition."routeId"
       OR segment."organizationId" <> definition."organizationId"
       OR NOT EXISTS (
         SELECT 1 FROM "RouteVersionWallSegment" scope
         WHERE scope."routeVersionId" = definition."routeVersionId"
           AND scope."wallSegmentId" = definition."wallSegmentId"
           AND scope."organizationId" = definition."organizationId"
       )
       OR NOT EXISTS (
         SELECT 1 FROM "Membership" membership
         WHERE membership."accountId" = definition."createdByAccountId"
           AND membership."organizationId" = definition."organizationId"
       )
       OR NOT EXISTS (
         SELECT 1 FROM "Membership" membership
         WHERE membership."accountId" = definition."updatedByAccountId"
           AND membership."organizationId" = definition."organizationId"
       )
  `,
  placementScopeMismatch: `
    SELECT COUNT(*)::int AS count
    FROM "RouteHoldPlacement" placement
    JOIN "RouteVersion" version ON version."id" = placement."routeVersionId"
    JOIN "WallHole" hole ON hole."id" = placement."wallHoleId"
    WHERE version."organizationId" <> placement."organizationId"
       OR hole."organizationId" <> placement."organizationId"
       OR NOT EXISTS (
         SELECT 1 FROM "RouteVersionWallSegment" scope
         WHERE scope."routeVersionId" = placement."routeVersionId"
           AND scope."wallSegmentId" = hole."wallSegmentId"
           AND scope."geometryVersionId" = hole."geometryVersionId"
       )
  `,
  placementWithoutPrimaryAnchor: `
    SELECT COUNT(*)::int AS count
    FROM "RouteHoldPlacement" placement
    WHERE NOT EXISTS (
      SELECT 1 FROM "RouteHoldPlacementAnchor" anchor
      WHERE anchor."placementId" = placement."id" AND anchor."role" = 'PRIMARY'
    )
  `,
  activeInstallationWithoutPrimaryAnchor: `
    SELECT COUNT(*)::int AS count
    FROM "HoldInstallation" installation
    WHERE installation."status" = 'INSTALLED'
      AND NOT EXISTS (
        SELECT 1 FROM "HoldInstallationAnchor" anchor
        WHERE anchor."installationId" = installation."id"
          AND anchor."role" = 'PRIMARY' AND anchor."releasedAt" IS NULL
      )
  `,
  climbObservationVersionMismatch: `
    SELECT COUNT(*)::int AS count
    FROM "ClimbObservation" observation
    JOIN "RouteVersion" version ON version."id" = observation."routeVersionId"
    WHERE version."organizationId" <> observation."organizationId"
       OR version."routeId" <> observation."routeId"
       OR (observation."wallSegmentId" IS NOT NULL AND NOT EXISTS (
         SELECT 1 FROM "RouteVersionWallSegment" scope
         WHERE scope."routeVersionId" = observation."routeVersionId"
           AND scope."wallSegmentId" = observation."wallSegmentId"
       ))
  `,
  cameraObservationReviewScopeMismatch: `
    SELECT COUNT(*)::int AS count
    FROM "CameraObservationReview" review
    JOIN "ClimbObservation" observation ON observation."id" = review."observationId"
    WHERE observation."organizationId" <> review."organizationId"
       OR NOT EXISTS (
         SELECT 1 FROM "Membership" membership
         WHERE membership."accountId" = review."reviewedByAccountId"
           AND membership."organizationId" = review."organizationId"
           AND membership."status" = 'ACTIVE'
       )
  `,
  cameraObservationEvidenceScopeMismatch: `
    SELECT COUNT(*)::int AS count
    FROM "CameraObservationEvidence" evidence
    JOIN "ClimbObservation" observation ON observation."id" = evidence."observationId"
    WHERE observation."organizationId" <> evidence."organizationId"
       OR (evidence."status" = 'AVAILABLE' AND evidence."expiredAt" IS NOT NULL)
       OR (evidence."status" = 'EXPIRED' AND evidence."expiredAt" IS NULL)
  `,
  cameraObservationEvidenceStateMismatch: `
    SELECT COUNT(*)::int AS count
    FROM "ClimbObservation" observation
    LEFT JOIN "CameraObservationEvidence" evidence
      ON evidence."observationId" = observation."id"
    WHERE (evidence."id" IS NULL AND observation."evidenceState" IN ('AVAILABLE', 'EXPIRED'))
       OR (evidence."status" = 'AVAILABLE' AND observation."evidenceState" <> 'AVAILABLE')
       OR (evidence."status" = 'EXPIRED' AND observation."evidenceState" <> 'EXPIRED')
  `,
  negativeInventoryBalance: `
    SELECT COUNT(*)::int AS count
    FROM "HoldInventoryBalance"
    WHERE "warehouseQuantity" < 0 OR "installedQuantity" < 0
       OR "reservedQuantity" < 0 OR "maintenanceQuantity" < 0
  `,
  holdVariantColorLifecycleMismatch: `
    SELECT COUNT(*)::int AS count
    FROM "HoldVariant"
    WHERE ("deletedAt" IS NULL AND "activeColor" IS DISTINCT FROM "color")
       OR ("deletedAt" IS NOT NULL AND "activeColor" IS NOT NULL)
  `,
  holdModelProcessingScopeMismatch: `
    SELECT COUNT(*)::int AS count
    FROM "HoldModelProcessingJob" job
    JOIN "HoldScan" scan ON scan."id" = job."scanId"
    JOIN "HoldAsset" source ON source."id" = job."sourceAssetId"
    LEFT JOIN "HoldAsset" output ON output."id" = job."outputAssetId"
    WHERE scan."organizationId" <> job."organizationId"
       OR source."organizationId" <> job."organizationId"
       OR source."scanId" <> job."scanId"
       OR source."kind" <> 'MODEL_SOURCE'
       OR NOT EXISTS (
         SELECT 1 FROM "Membership" membership
         WHERE membership."accountId" = job."requestedByAccountId"
           AND membership."organizationId" = job."organizationId"
       )
       OR (job."outputAssetId" IS NOT NULL AND (
         output."id" IS NULL
         OR output."organizationId" <> job."organizationId"
         OR output."scanId" <> job."scanId"
         OR output."kind" <> 'MODEL_3D'
         OR output."sourceAssetId" <> job."sourceAssetId"
       ))
  `,
  holdModelProcessingStateMismatch: `
    SELECT COUNT(*)::int AS count
    FROM "HoldModelProcessingJob"
    WHERE ("status" IN ('COMPLETED', 'NEEDS_REVIEW') AND (
             "outputAssetId" IS NULL OR "completedAt" IS NULL
           ))
       OR ("status" IN ('FAILED', 'CANCELLED') AND (
             "outputAssetId" IS NOT NULL OR "completedAt" IS NULL
           ))
       OR ("status" = 'PROCESSING' AND "startedAt" IS NULL)
       OR ("status" = 'QUEUED' AND "outputAssetId" IS NOT NULL)
  `,
  holdUnitScopeMismatch: `
    SELECT COUNT(*)::int AS count
    FROM "HoldUnit" unit
    JOIN "HoldVariant" variant ON variant."id" = unit."holdVariantId"
    JOIN "HoldModel" model ON model."id" = variant."holdModelId"
    JOIN "Facility" facility ON facility."id" = unit."currentFacilityId"
    JOIN "HoldUnitRegistrationBatch" batch ON batch."id" = unit."registrationBatchId"
    WHERE model."organizationId" <> unit."ownerOrganizationId"
       OR facility."organizationId" <> unit."currentCustodianOrganizationId"
       OR batch."organizationId" <> unit."ownerOrganizationId"
       OR batch."holdVariantId" <> unit."holdVariantId"
  `,
  holdUnitTagScopeMismatch: `
    SELECT COUNT(*)::int AS count
    FROM "HoldUnitTagBinding" binding
    JOIN "HoldUnit" unit ON unit."id" = binding."holdUnitId"
    JOIN "RfidTag" tag ON tag."id" = binding."rfidTagId"
    WHERE unit."ownerOrganizationId" <> tag."organizationId"
  `,
  trackedUnitsExceedInventory: `
    SELECT COUNT(*)::int AS count
    FROM (
      SELECT unit."holdVariantId", COUNT(*)::int AS quantity
      FROM "HoldUnit" unit
      WHERE unit."operationalStatus" <> 'RETIRED'
      GROUP BY unit."holdVariantId"
    ) tracked
    JOIN "HoldInventoryBalance" balance ON balance."variantId" = tracked."holdVariantId"
    WHERE tracked.quantity > (
      balance."warehouseQuantity" + balance."installedQuantity" +
      balance."reservedQuantity" + balance."maintenanceQuantity"
    )
  `,
  holdTrackingModeMismatch: `
    SELECT COUNT(*)::int AS count
    FROM "HoldVariant" variant
    JOIN "HoldInventoryBalance" balance ON balance."variantId" = variant."id"
    LEFT JOIN (
      SELECT unit."holdVariantId", COUNT(*)::int AS quantity
      FROM "HoldUnit" unit
      WHERE unit."operationalStatus" <> 'RETIRED'
      GROUP BY unit."holdVariantId"
    ) tracked ON tracked."holdVariantId" = variant."id"
    WHERE (variant."trackingMode" = 'QUANTITY' AND COALESCE(tracked.quantity, 0) <> 0)
       OR (variant."trackingMode" = 'HYBRID' AND (
         COALESCE(tracked.quantity, 0) = 0 OR
         COALESCE(tracked.quantity, 0) >= (
           balance."warehouseQuantity" + balance."installedQuantity" +
           balance."reservedQuantity" + balance."maintenanceQuantity"
         )
       ))
       OR (variant."trackingMode" = 'SERIALIZED' AND COALESCE(tracked.quantity, 0) <> (
         balance."warehouseQuantity" + balance."installedQuantity" +
         balance."reservedQuantity" + balance."maintenanceQuantity"
       ))
  `,
  rfidInventorySessionScopeMismatch: `
    SELECT COUNT(*)::int AS count
    FROM "RfidInventorySession" session
    JOIN "Facility" facility ON facility."id" = session."facilityId"
    WHERE facility."organizationId" <> session."organizationId"
       OR NOT EXISTS (
         SELECT 1 FROM "Membership" membership
         WHERE membership."accountId" = session."createdByAccountId"
           AND membership."organizationId" = session."organizationId"
       )
       OR (session."completedByAccountId" IS NOT NULL AND NOT EXISTS (
         SELECT 1 FROM "Membership" membership
         WHERE membership."accountId" = session."completedByAccountId"
           AND membership."organizationId" = session."organizationId"
       ))
  `,
  rfidInventoryExpectedScopeMismatch: `
    SELECT COUNT(*)::int AS count
    FROM "RfidInventoryExpectedUnit" expected
    JOIN "RfidInventorySession" session ON session."id" = expected."sessionId"
    JOIN "RfidTag" tag ON tag."id" = expected."rfidTagId"
    JOIN "HoldUnit" unit ON unit."id" = expected."holdUnitId"
    WHERE tag."epc" <> expected."epc"
       OR NOT EXISTS (
         SELECT 1 FROM "HoldUnitTagBinding" binding
         WHERE binding."holdUnitId" = unit."id" AND binding."rfidTagId" = tag."id"
       )
  `,
  rfidInventoryObservationScopeMismatch: `
    SELECT COUNT(*)::int AS count
    FROM "RfidInventoryObservation" observation
    JOIN "RfidInventorySession" session ON session."id" = observation."sessionId"
    LEFT JOIN "RfidTag" tag ON tag."id" = observation."rfidTagId"
    LEFT JOIN "HoldUnit" unit ON unit."id" = observation."holdUnitId"
    WHERE (observation."matchStatus" IN ('MATCHED_EXPECTED', 'MATCHED_UNEXPECTED') AND (
             tag."id" IS NULL OR unit."id" IS NULL OR tag."epc" <> observation."epc"
             OR NOT EXISTS (
               SELECT 1 FROM "HoldUnitTagBinding" binding
               WHERE binding."holdUnitId" = unit."id" AND binding."rfidTagId" = tag."id"
             )
           ))
       OR (observation."matchStatus" = 'UNBOUND' AND (
             tag."id" IS NULL OR unit."id" IS NOT NULL OR tag."epc" <> observation."epc"
             OR tag."organizationId" <> session."organizationId"
           ))
       OR (observation."matchStatus" = 'UNKNOWN' AND (
             tag."id" IS NOT NULL OR unit."id" IS NOT NULL
           ))
  `,
  rfidInventoryReadBatchScopeMismatch: `
    SELECT COUNT(*)::int AS count
    FROM "RfidInventoryReadBatch" batch
    JOIN "RfidInventorySession" session ON session."id" = batch."sessionId"
    WHERE session."organizationId" <> batch."organizationId"
       OR NOT EXISTS (
         SELECT 1 FROM "Membership" membership
         WHERE membership."accountId" = batch."createdByAccountId"
           AND membership."organizationId" = batch."organizationId"
       )
  `,
  wallSettingReservationScopeMismatch: `
    SELECT COUNT(*)::int AS count
    FROM "WallSettingJobHoldReservation" reservation
    JOIN "WallSettingJob" job ON job."id" = reservation."settingJobId"
    JOIN "HoldVariant" variant ON variant."id" = reservation."holdVariantId"
    JOIN "HoldModel" model ON model."id" = variant."holdModelId"
    WHERE job."organizationId" <> reservation."organizationId"
       OR model."organizationId" <> reservation."organizationId"
  `,
  activeReservationExceedsReservedBalance: `
    SELECT COUNT(*)::int AS count
    FROM (
      SELECT reservation."holdVariantId", SUM(reservation."quantity") AS quantity
      FROM "WallSettingJobHoldReservation" reservation
      WHERE reservation."status" = 'ACTIVE'
      GROUP BY reservation."holdVariantId"
    ) active
    LEFT JOIN "HoldInventoryBalance" balance ON balance."variantId" = active."holdVariantId"
    WHERE balance."id" IS NULL OR active.quantity > balance."reservedQuantity"
  `,
} as const;

async function main(): Promise<void> {
  const prisma = new PrismaService();
  await prisma.$connect();
  try {
    const results: Record<string, number> = {};
    for (const [name, query] of Object.entries(checks)) {
      const rows = await prisma.$queryRawUnsafe<Array<{ count: number }>>(query);
      results[name] = rows[0]?.count ?? -1;
    }
    console.log(JSON.stringify(results, null, 2));
    const failures = Object.entries(results).filter(([, count]) => count !== 0);
    if (failures.length) {
      throw new Error(
        `Database invariant violations: ${failures.map(([name]) => name).join(', ')}`,
      );
    }
  } finally {
    await prisma.$disconnect();
  }
}

void main().catch((error: unknown) => {
  console.error(error);
  process.exitCode = 1;
});
