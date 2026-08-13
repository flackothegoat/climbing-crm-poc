import { ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import {
  PlacementAnchorRole,
  RouteDataSource,
  RouteStatus,
  RouteVersionStatus,
  WallCalibrationStatus,
  WallGeometryVersionStatus,
  WallStatus,
  type Prisma,
} from '@prisma/client';
import type { CurrentSession } from '../auth/session.service';
import { AuditService } from '../common/audit.service';
import { PrismaService } from '../database/prisma.service';
import { lockHoldOrganization } from '../holds/hold-transaction-lock';
import { AccessControlService, Capability } from '../security/access-control.service';
import {
  createDummyObservations,
  placementsForRoute,
  WALL_SEGMENT_SEEDS,
  W06_AREA,
  W06_HOLE_SEEDS,
  W06_ROUTE_SEEDS,
} from './w06-demo-data';

const activeVersionStatuses = [RouteVersionStatus.DRAFT, RouteVersionStatus.PUBLISHED];

@Injectable()
export class WallService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly access: AccessControlService,
  ) {}

  async list(session: CurrentSession) {
    this.access.assert(session, Capability.ASSET_READ);
    const areas = await this.prisma.wallArea.findMany({
      where: { organizationId: session.organization.id },
      orderBy: { code: 'asc' },
      include: {
        segments: {
          orderBy: { code: 'asc' },
          include: {
            geometryVersions: {
              where: { status: WallGeometryVersionStatus.PUBLISHED },
              orderBy: { versionNumber: 'desc' },
              take: 1,
              include: { _count: { select: { holes: true } } },
            },
            routeVersionSegments: {
              where: { routeVersion: { status: { in: activeVersionStatuses } } },
              select: { routeVersion: { select: { routeId: true } } },
            },
          },
        },
      },
    });
    return areas.map(mapArea);
  }

  async get(session: CurrentSession, wallCode: string) {
    this.access.assert(session, Capability.ASSET_READ);
    const segment = await this.prisma.wallSegment.findFirst({
      where: { organizationId: session.organization.id, code: wallCode },
      include: {
        area: true,
        geometryVersions: {
          where: { status: WallGeometryVersionStatus.PUBLISHED },
          orderBy: { versionNumber: 'desc' },
          take: 1,
          include: { holes: { orderBy: [{ row: 'asc' }, { column: 'asc' }] } },
        },
        routeVersionSegments: {
          where: { routeVersion: { status: { in: activeVersionStatuses } } },
          include: { routeVersion: { include: { route: true } } },
        },
      },
    });
    if (!segment) throw new NotFoundException('墙面不存在');
    const geometry = segment.geometryVersions[0];
    if (!geometry) throw new ConflictException('墙面缺少已发布几何版本');
    return {
      id: segment.id,
      organizationId: segment.organizationId,
      areaId: segment.areaId,
      code: segment.code,
      name: segment.name,
      status: segment.status,
      metadata: segment.metadata,
      area: segment.area,
      geometryVersion: geometry,
      holes: geometry.holes,
      routes: currentRoutes(segment.routeVersionSegments),
      routePlanRevision: segment.routePlanRevision,
      createdAt: segment.createdAt,
      updatedAt: segment.updatedAt,
    };
  }

  async seedW06Demo(session: CurrentSession) {
    this.access.assert(session, Capability.ASSET_DRAFT_WRITE);
    const result = await this.prisma.$transaction(async (transaction) => {
      await lockHoldOrganization(transaction, session.organization.id);
      const area = await upsertArea(transaction, session.organization.id);
      await upsertSegments(transaction, session.organization.id, area.id);
      await upsertSegmentAdjacencies(transaction, session.organization.id, area.id);
      const wall = await transaction.wallSegment.findUniqueOrThrow({
        where: { organizationId_code: { organizationId: session.organization.id, code: 'W06' } },
      });
      const geometry = await transaction.wallGeometryVersion.findUniqueOrThrow({
        where: { wallSegmentId_versionNumber: { wallSegmentId: wall.id, versionNumber: 1 } },
      });
      await seedHoles(transaction, session.organization.id, wall.id, geometry.id);
      const routes = await seedRoutes(transaction, session, wall.id, geometry.id);
      await seedObservations(transaction, session.organization.id, wall.id, routes);
      await this.audit.record(
        {
          organizationId: session.organization.id,
          actorAccountId: session.account.id,
          type: 'wall.demo.w06.seeded',
          outcome: 'SUCCESS',
          metadata: { wallSegmentId: wall.id, source: 'DUMMY' },
        },
        transaction,
      );
      return { wallCode: wall.code, routeCount: routes.size, holeCount: W06_HOLE_SEEDS.length };
    });
    return { ...result, dataSource: 'DUMMY', calibration: 'SURVEY_ESTIMATE' };
  }

  async ensureW06Workspace(session: CurrentSession) {
    this.access.assert(session, Capability.ASSET_DRAFT_WRITE);
    return this.prisma.$transaction(async (transaction) => {
      await lockHoldOrganization(transaction, session.organization.id);
      const area = await upsertArea(transaction, session.organization.id);
      await upsertSegments(transaction, session.organization.id, area.id);
      await upsertSegmentAdjacencies(transaction, session.organization.id, area.id);
      const wall = await transaction.wallSegment.findUniqueOrThrow({
        where: { organizationId_code: { organizationId: session.organization.id, code: 'W06' } },
      });
      const geometry = await transaction.wallGeometryVersion.findUniqueOrThrow({
        where: { wallSegmentId_versionNumber: { wallSegmentId: wall.id, versionNumber: 1 } },
      });
      await seedHoles(transaction, session.organization.id, wall.id, geometry.id);
      return { wallCode: wall.code, holeCount: W06_HOLE_SEEDS.length, routeCount: 0 };
    });
  }
}

function currentRoutes(
  segments: Array<{
    routeVersion: {
      routeId: string;
      status: RouteVersionStatus;
      versionNumber: number;
      route: unknown;
    };
  }>,
) {
  const selected = new Map<string, (typeof segments)[number]['routeVersion']>();
  for (const item of segments) {
    const version = item.routeVersion;
    const existing = selected.get(version.routeId);
    const priority =
      (version.status === RouteVersionStatus.DRAFT ? 1_000_000 : 0) + version.versionNumber;
    const existingPriority = existing
      ? (existing.status === RouteVersionStatus.DRAFT ? 1_000_000 : 0) + existing.versionNumber
      : -1;
    if (priority > existingPriority) selected.set(version.routeId, version);
  }
  return [...selected.values()].map((version) => version.route);
}

async function upsertSegmentAdjacencies(
  transaction: Prisma.TransactionClient,
  organizationId: string,
  areaId: string,
) {
  const segments = await transaction.wallSegment.findMany({
    where: { organizationId, areaId },
    orderBy: { code: 'asc' },
    select: { id: true },
  });
  for (let index = 0; index < segments.length - 1; index += 1) {
    const pair = [segments[index]!.id, segments[index + 1]!.id].sort();
    const [segmentAId, segmentBId] = pair as [string, string];
    await transaction.wallSegmentAdjacency.upsert({
      where: { segmentAId_segmentBId: { segmentAId, segmentBId } },
      create: {
        organizationId,
        areaId,
        segmentAId,
        segmentBId,
        calibration: WallCalibrationStatus.SURVEY_ESTIMATE,
        metadata: { source: 'DEMO_CODE_ORDER' },
      },
      update: {},
    });
  }
}

async function upsertArea(transaction: Prisma.TransactionClient, organizationId: string) {
  return transaction.wallArea.upsert({
    where: { organizationId_code: { organizationId, code: W06_AREA.code } },
    create: {
      organizationId,
      ...W06_AREA,
      status: WallStatus.ACTIVE,
      calibration: WallCalibrationStatus.SURVEY_ESTIMATE,
    },
    update: { name: W06_AREA.name, floorLabel: W06_AREA.floorLabel },
  });
}

async function upsertSegments(
  transaction: Prisma.TransactionClient,
  organizationId: string,
  areaId: string,
) {
  for (const segment of WALL_SEGMENT_SEEDS) {
    const wall = await transaction.wallSegment.upsert({
      where: { organizationId_code: { organizationId, code: segment.code } },
      create: {
        organizationId,
        areaId,
        code: segment.code,
        name: segment.name,
        metadata: segment.metadata,
        status: WallStatus.ACTIVE,
      },
      update: { areaId, name: segment.name, metadata: segment.metadata },
    });
    await transaction.wallGeometryVersion.upsert({
      where: { wallSegmentId_versionNumber: { wallSegmentId: wall.id, versionNumber: 1 } },
      create: {
        organizationId,
        wallSegmentId: wall.id,
        versionNumber: 1,
        status: WallGeometryVersionStatus.PUBLISHED,
        calibration: WallCalibrationStatus.SURVEY_ESTIMATE,
        widthMm: segment.widthMm,
        heightMm: segment.heightMm,
        surfaceHeightMm: segment.surfaceHeightMm,
        angleFromVerticalDegrees: segment.angleFromVerticalDegrees,
        horizontalPitchMm: segment.horizontalPitchMm,
        verticalPitchMm: segment.verticalPitchMm,
        coordinateSystem: segment.metadata,
        note: 'W06 演示测绘估算兼容基线；非现场校准数据。',
      },
      update: {},
    });
  }
}

async function seedHoles(
  transaction: Prisma.TransactionClient,
  organizationId: string,
  wallSegmentId: string,
  geometryVersionId: string,
) {
  await transaction.wallHole.createMany({
    data: W06_HOLE_SEEDS.map((hole) => ({
      ...hole,
      organizationId,
      wallSegmentId,
      geometryVersionId,
      calibration: WallCalibrationStatus.SURVEY_ESTIMATE,
    })),
    skipDuplicates: true,
  });
}

interface SeedRouteIdentity {
  routeId: string;
  routeVersionId: string;
}

async function seedRoutes(
  transaction: Prisma.TransactionClient,
  session: CurrentSession,
  wallSegmentId: string,
  geometryVersionId: string,
) {
  const routeIds = new Map<string, SeedRouteIdentity>();
  for (const seed of W06_ROUTE_SEEDS) {
    let route = await transaction.route.findUnique({
      where: { organizationId_code: { organizationId: session.organization.id, code: seed.code } },
      include: {
        versions: { include: { wallSegments: true }, orderBy: { versionNumber: 'desc' } },
      },
    });
    if (!route) {
      route = await createSeedRoute(transaction, session, wallSegmentId, geometryVersionId, seed);
    }
    const version = route.versions.find((candidate) =>
      candidate.wallSegments.some((item) => item.wallSegmentId === wallSegmentId),
    );
    if (!version) throw new ConflictException('W06 演示线路编号已用于其他墙面');
    routeIds.set(seed.code, { routeId: route.id, routeVersionId: version.id });
  }
  return routeIds;
}

async function createSeedRoute(
  transaction: Prisma.TransactionClient,
  session: CurrentSession,
  wallSegmentId: string,
  geometryVersionId: string,
  seed: (typeof W06_ROUTE_SEEDS)[number],
) {
  const holes = await transaction.wallHole.findMany({
    where: { organizationId: session.organization.id, wallSegmentId, geometryVersionId },
    select: { id: true, code: true },
  });
  const holeIds = new Map(holes.map((hole) => [hole.code, hole.id]));
  return transaction.route.create({
    data: {
      organizationId: session.organization.id,
      ...seed,
      status: RouteStatus.DRAFT,
      dataSource: RouteDataSource.DUMMY,
      versions: {
        create: {
          organizationId: session.organization.id,
          versionNumber: 1,
          status: RouteVersionStatus.DRAFT,
          dataSource: RouteDataSource.DUMMY,
          note: 'W06 前端原型迁移种子；非现场线路。',
          createdByAccountId: session.account.id,
          wallSegments: {
            create: {
              organizationId: session.organization.id,
              wallSegmentId,
              geometryVersionId,
              ordinal: 0,
            },
          },
          placements: {
            create: placementsForRoute(seed.code).map((placement) => ({
              organizationId: session.organization.id,
              wallHoleId: holeIds.get(placement.holeCode)!,
              demoAssetKey: placement.demoAssetKey,
              role: placement.role,
              rotationDegrees: placement.rotationDegrees,
              dataSource: RouteDataSource.DUMMY,
              anchors: {
                create: {
                  organizationId: session.organization.id,
                  wallHoleId: holeIds.get(placement.holeCode)!,
                  role: PlacementAnchorRole.PRIMARY,
                  ordinal: 0,
                },
              },
            })),
          },
        },
      },
    },
    include: { versions: { include: { wallSegments: true }, orderBy: { versionNumber: 'desc' } } },
  });
}

async function seedObservations(
  transaction: Prisma.TransactionClient,
  organizationId: string,
  wallSegmentId: string,
  routeIds: Map<string, SeedRouteIdentity>,
) {
  await transaction.climbObservation.createMany({
    data: createDummyObservations(routeIds).map((observation) => ({
      ...observation,
      organizationId,
      wallSegmentId,
    })),
    skipDuplicates: true,
  });
}

type AreaListItem = Prisma.WallAreaGetPayload<{
  include: {
    segments: {
      include: {
        geometryVersions: { include: { _count: { select: { holes: true } } } };
        routeVersionSegments: { select: { routeVersion: { select: { routeId: true } } } };
      };
    };
  };
}>;

function mapArea(area: AreaListItem) {
  return {
    id: area.id,
    code: area.code,
    name: area.name,
    floorLabel: area.floorLabel,
    status: area.status,
    calibration: area.calibration,
    segments: area.segments.map((segment) => {
      const geometry = segment.geometryVersions[0];
      return {
        id: segment.id,
        code: segment.code,
        name: segment.name,
        widthMm: geometry?.widthMm ?? null,
        heightMm: geometry?.heightMm ?? null,
        surfaceHeightMm: geometry?.surfaceHeightMm ?? null,
        angleFromVerticalDegrees: geometry?.angleFromVerticalDegrees ?? null,
        horizontalPitchMm: geometry?.horizontalPitchMm ?? null,
        verticalPitchMm: geometry?.verticalPitchMm ?? null,
        status: segment.status,
        calibration: geometry?.calibration ?? null,
        metadata: segment.metadata,
        holeCount: geometry?._count.holes ?? 0,
        routeCount: new Set(segment.routeVersionSegments.map((item) => item.routeVersion.routeId))
          .size,
      };
    }),
  };
}
