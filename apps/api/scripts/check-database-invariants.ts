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
    WHERE route."organizationId" <> version."organizationId"
  `,
  routeSegmentScopeMismatch: `
    SELECT COUNT(*)::int AS count
    FROM "RouteVersionWallSegment" scope
    JOIN "RouteVersion" version ON version."id" = scope."routeVersionId"
    JOIN "WallSegment" segment ON segment."id" = scope."wallSegmentId"
    JOIN "WallGeometryVersion" geometry ON geometry."id" = scope."geometryVersionId"
    WHERE version."organizationId" <> scope."organizationId"
       OR segment."organizationId" <> scope."organizationId"
       OR geometry."organizationId" <> scope."organizationId"
       OR geometry."wallSegmentId" <> scope."wallSegmentId"
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
  negativeInventoryBalance: `
    SELECT COUNT(*)::int AS count
    FROM "HoldInventoryBalance"
    WHERE "warehouseQuantity" < 0 OR "installedQuantity" < 0
       OR "reservedQuantity" < 0 OR "maintenanceQuantity" < 0
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
