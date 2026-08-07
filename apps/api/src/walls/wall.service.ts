import { ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import {
  RouteDataSource,
  RouteStatus,
  RouteVersionStatus,
  WallCalibrationStatus,
  WallStatus,
  type Prisma,
} from '@prisma/client';
import type { CurrentSession } from '../auth/session.service';
import { AuditService } from '../common/audit.service';
import { PrismaService } from '../database/prisma.service';
import { AccessControlService, Capability } from '../security/access-control.service';
import { lockHoldOrganization } from '../holds/hold-transaction-lock';
import {
  createDummyObservations,
  placementsForRoute,
  WALL_SEGMENT_SEEDS,
  W06_AREA,
  W06_HOLE_SEEDS,
  W06_ROUTE_SEEDS,
} from './w06-demo-data';

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
          include: { _count: { select: { holes: true, routes: true } } },
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
        holes: { orderBy: [{ row: 'asc' }, { column: 'asc' }] },
        routes: { orderBy: { code: 'asc' } },
      },
    });
    if (!segment) throw new NotFoundException('墙面不存在');
    return segment;
  }

  async seedW06Demo(session: CurrentSession) {
    this.access.assert(session, Capability.ASSET_DRAFT_WRITE);
    const result = await this.prisma.$transaction(async (transaction) => {
      await lockHoldOrganization(transaction, session.organization.id);
      const area = await upsertArea(transaction, session.organization.id);
      await upsertSegments(transaction, session.organization.id, area.id);
      const wall = await transaction.wallSegment.findUniqueOrThrow({
        where: {
          organizationId_code: { organizationId: session.organization.id, code: 'W06' },
        },
      });
      await seedHoles(transaction, session.organization.id, wall.id);
      const routes = await seedRoutes(transaction, session, wall.id);
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
    await transaction.wallSegment.upsert({
      where: { organizationId_code: { organizationId, code: segment.code } },
      create: {
        organizationId,
        areaId,
        ...segment,
        status: WallStatus.ACTIVE,
        calibration: WallCalibrationStatus.SURVEY_ESTIMATE,
      },
      update: { areaId, ...segment },
    });
  }
}

async function seedHoles(
  transaction: Prisma.TransactionClient,
  organizationId: string,
  wallSegmentId: string,
) {
  await transaction.wallHole.createMany({
    data: W06_HOLE_SEEDS.map((hole) => ({
      ...hole,
      organizationId,
      wallSegmentId,
      calibration: WallCalibrationStatus.SURVEY_ESTIMATE,
    })),
    skipDuplicates: true,
  });
}

async function seedRoutes(
  transaction: Prisma.TransactionClient,
  session: CurrentSession,
  wallSegmentId: string,
) {
  const routeIds = new Map<string, string>();
  for (const seed of W06_ROUTE_SEEDS) {
    let route = await transaction.route.findUnique({
      where: {
        organizationId_code: { organizationId: session.organization.id, code: seed.code },
      },
    });
    if (route && route.wallSegmentId !== wallSegmentId) {
      throw new ConflictException('W06 演示线路编号已用于其他墙面');
    }
    if (!route) route = await createSeedRoute(transaction, session, wallSegmentId, seed);
    routeIds.set(seed.code, route.id);
  }
  return routeIds;
}

async function createSeedRoute(
  transaction: Prisma.TransactionClient,
  session: CurrentSession,
  wallSegmentId: string,
  seed: (typeof W06_ROUTE_SEEDS)[number],
) {
  const holes = await transaction.wallHole.findMany({
    where: { organizationId: session.organization.id, wallSegmentId },
    select: { id: true, code: true },
  });
  const holeIds = new Map(holes.map((hole) => [hole.code, hole.id]));
  return transaction.route.create({
    data: {
      organizationId: session.organization.id,
      wallSegmentId,
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
          placements: {
            create: placementsForRoute(seed.code).map((placement) => ({
              organizationId: session.organization.id,
              wallHoleId: holeIds.get(placement.holeCode)!,
              demoAssetKey: placement.demoAssetKey,
              role: placement.role,
              rotationDegrees: placement.rotationDegrees,
              dataSource: RouteDataSource.DUMMY,
            })),
          },
        },
      },
    },
  });
}

async function seedObservations(
  transaction: Prisma.TransactionClient,
  organizationId: string,
  wallSegmentId: string,
  routeIds: Map<string, string>,
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
    segments: { include: { _count: { select: { holes: true; routes: true } } } };
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
    segments: area.segments.map((segment) => ({
      id: segment.id,
      code: segment.code,
      name: segment.name,
      widthMm: segment.widthMm,
      heightMm: segment.heightMm,
      surfaceHeightMm: segment.surfaceHeightMm,
      angleFromVerticalDegrees: segment.angleFromVerticalDegrees,
      horizontalPitchMm: segment.horizontalPitchMm,
      verticalPitchMm: segment.verticalPitchMm,
      status: segment.status,
      calibration: segment.calibration,
      metadata: segment.metadata,
      holeCount: segment._count.holes,
      routeCount: segment._count.routes,
    })),
  };
}
