import { ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { RouteDataSource, RouteStatus, RouteVersionStatus, type Prisma } from '@prisma/client';
import type { CurrentSession } from '../auth/session.service';
import { AuditService } from '../common/audit.service';
import { PrismaService } from '../database/prisma.service';
import { lockHoldOrganization } from '../holds/hold-transaction-lock';
import { AccessControlService, Capability } from '../security/access-control.service';
import type { SaveRouteSettingPlanInput } from './wall-route.dto';

const routePlanInclude = {
  routes: {
    orderBy: { code: 'asc' },
    include: {
      versions: {
        orderBy: { versionNumber: 'desc' },
        include: { placements: { include: { wallHole: true } } },
      },
    },
  },
} satisfies Prisma.WallSegmentInclude;

type WallWithRoutePlan = Prisma.WallSegmentGetPayload<{ include: typeof routePlanInclude }>;

@Injectable()
export class RouteSettingService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly access: AccessControlService,
  ) {}

  async getPlan(session: CurrentSession, wallCode: string) {
    this.access.assert(session, Capability.ASSET_READ);
    const wall = await this.prisma.wallSegment.findFirst({
      where: { organizationId: session.organization.id, code: wallCode },
      include: routePlanInclude,
    });
    if (!wall) throw new NotFoundException('墙面定线数据尚未初始化');
    return mapRoutePlan(wall);
  }

  async savePlan(session: CurrentSession, wallCode: string, input: SaveRouteSettingPlanInput) {
    this.access.assert(session, Capability.ASSET_DRAFT_WRITE);
    if (input.wall.code !== wallCode) throw new ConflictException('路径墙面与定线计划不一致');
    await this.prisma.$transaction(async (transaction) => {
      await lockHoldOrganization(transaction, session.organization.id);
      const wall = await findWall(transaction, session.organization.id, wallCode);
      const holes = await findPlanHoles(transaction, session.organization.id, wall.id, input);
      await saveRoutes(transaction, session, wall.id, holes, input);
      await this.audit.record(
        {
          organizationId: session.organization.id,
          actorAccountId: session.account.id,
          type: 'route.setting_plan.saved',
          outcome: 'SUCCESS',
          metadata: {
            wallSegmentId: wall.id,
            routeCount: input.routes.length,
            placementCount: input.placements.length,
          },
        },
        transaction,
      );
    });
    return this.getPlan(session, wallCode);
  }
}

async function findWall(
  transaction: Prisma.TransactionClient,
  organizationId: string,
  wallCode: string,
) {
  const wall = await transaction.wallSegment.findFirst({
    where: { organizationId, code: wallCode },
  });
  if (!wall) throw new NotFoundException('墙面不存在');
  return wall;
}

async function findPlanHoles(
  transaction: Prisma.TransactionClient,
  organizationId: string,
  wallSegmentId: string,
  input: SaveRouteSettingPlanInput,
) {
  const requestedCodes = [...new Set(input.placements.map((placement) => placement.holeId))];
  const holes = await transaction.wallHole.findMany({
    where: { organizationId, wallSegmentId, code: { in: requestedCodes } },
    select: { id: true, code: true },
  });
  if (holes.length !== requestedCodes.length) throw new ConflictException('计划包含无效或跨墙孔位');
  return new Map(holes.map((hole) => [hole.code, hole.id]));
}

async function saveRoutes(
  transaction: Prisma.TransactionClient,
  session: CurrentSession,
  wallSegmentId: string,
  holes: Map<string, string>,
  input: SaveRouteSettingPlanInput,
) {
  await assertFormalAssetsBelongToOrganization(transaction, session.organization.id, input);
  for (const routeInput of input.routes) {
    const placements = input.placements.filter((item) => item.routeId === routeInput.id);
    const dataSource = placements.every((item) => item.assetId.startsWith('test-'))
      ? RouteDataSource.DUMMY
      : RouteDataSource.MANUAL;
    const route = await upsertRoute(
      transaction,
      session.organization.id,
      wallSegmentId,
      routeInput,
      dataSource,
    );
    const version = await findOrCreateDraftVersion(transaction, session, route.id, dataSource);
    if (version.dataSource !== dataSource) {
      await transaction.routeVersion.update({
        where: { id: version.id },
        data: { dataSource },
      });
    }
    await replacePlacements(transaction, session.organization.id, version.id, holes, placements);
  }
}

async function assertFormalAssetsBelongToOrganization(
  transaction: Prisma.TransactionClient,
  organizationId: string,
  input: SaveRouteSettingPlanInput,
) {
  const variantIds = [
    ...new Set(
      input.placements
        .filter((placement) => !placement.assetId.startsWith('test-'))
        .map((placement) => placement.assetId),
    ),
  ];
  if (!variantIds.length) return;
  const count = await transaction.holdVariant.count({
    where: {
      id: { in: variantIds },
      deletedAt: null,
      holdModel: { organizationId },
    },
  });
  if (count !== variantIds.length) throw new ConflictException('计划包含无效或跨岩馆岩点档案');
}

async function upsertRoute(
  transaction: Prisma.TransactionClient,
  organizationId: string,
  wallSegmentId: string,
  input: SaveRouteSettingPlanInput['routes'][number],
  dataSource: RouteDataSource,
) {
  const existing = await transaction.route.findUnique({
    where: { organizationId_code: { organizationId, code: input.id } },
  });
  if (existing && existing.wallSegmentId !== wallSegmentId) {
    throw new ConflictException('线路编号已用于其他墙面');
  }
  if (existing) {
    return transaction.route.update({
      where: { id: existing.id },
      data: {
        name: input.name,
        displayColor: input.color,
        grade: input.grade,
        status: RouteStatus.DRAFT,
        dataSource,
      },
    });
  }
  return transaction.route.create({
    data: {
      organizationId,
      wallSegmentId,
      code: input.id,
      name: input.name,
      displayColor: input.color,
      grade: input.grade,
      status: RouteStatus.DRAFT,
      dataSource,
    },
  });
}

async function findOrCreateDraftVersion(
  transaction: Prisma.TransactionClient,
  session: CurrentSession,
  routeId: string,
  dataSource: RouteDataSource,
) {
  const draft = await transaction.routeVersion.findFirst({
    where: { organizationId: session.organization.id, routeId, status: RouteVersionStatus.DRAFT },
    orderBy: { versionNumber: 'desc' },
  });
  if (draft) return draft;
  const latest = await transaction.routeVersion.aggregate({
    where: { organizationId: session.organization.id, routeId },
    _max: { versionNumber: true },
  });
  return transaction.routeVersion.create({
    data: {
      organizationId: session.organization.id,
      routeId,
      versionNumber: (latest._max.versionNumber ?? 0) + 1,
      status: RouteVersionStatus.DRAFT,
      dataSource,
      note: dataSource === RouteDataSource.DUMMY ? '由 W06 演示计划保存。' : null,
      createdByAccountId: session.account.id,
    },
  });
}

async function replacePlacements(
  transaction: Prisma.TransactionClient,
  organizationId: string,
  routeVersionId: string,
  holes: Map<string, string>,
  placements: SaveRouteSettingPlanInput['placements'],
) {
  await transaction.routeHoldPlacement.deleteMany({
    where: { organizationId, routeVersionId },
  });
  if (!placements.length) return;
  await transaction.routeHoldPlacement.createMany({
    data: placements.map((placement) => {
      const isDummy = placement.assetId.startsWith('test-');
      return {
        organizationId,
        routeVersionId,
        wallHoleId: holes.get(placement.holeId)!,
        holdVariantId: isDummy ? null : placement.assetId,
        demoAssetKey: isDummy ? placement.assetId : null,
        role: placement.role,
        rotationDegrees: placement.rotationDegrees,
        dataSource: isDummy ? RouteDataSource.DUMMY : RouteDataSource.MANUAL,
      };
    }),
  });
}

function mapRoutePlan(wall: WallWithRoutePlan) {
  const activeVersions = wall.routes.map((route) => ({
    route,
    version:
      route.versions.find((version) => version.status === RouteVersionStatus.DRAFT) ??
      route.versions[0],
  }));
  const updatedAt = activeVersions.reduce(
    (latest, item) =>
      item.version && item.version.updatedAt > latest ? item.version.updatedAt : latest,
    wall.updatedAt,
  );
  return {
    schemaVersion: 1 as const,
    persisted: true,
    dataSource: activeVersions.some((item) => item.route.dataSource === RouteDataSource.DUMMY)
      ? 'DUMMY'
      : 'MANUAL',
    wall: {
      code: wall.code,
      name: wall.name,
      widthMm: wall.widthMm,
      heightMm: wall.heightMm,
      surfaceHeightMm: wall.surfaceHeightMm ?? wall.heightMm,
      angleFromVerticalDegrees: wall.angleFromVerticalDegrees ?? 0,
    },
    calibration: {
      horizontalPitchMm: wall.horizontalPitchMm ?? 200,
      verticalPitchMm: wall.verticalPitchMm ?? 200,
      status:
        wall.calibration === 'FIELD_CALIBRATED'
          ? ('FIELD_CALIBRATED' as const)
          : ('ESTIMATED_FROM_SCAN' as const),
      note:
        wall.calibration === 'FIELD_CALIBRATED'
          ? '墙面孔位已经现场校准。'
          : '扫描估测草案；正式使用前须现场复核原点、行列、缺失孔和边界孔。',
    },
    routes: activeVersions.map(({ route }) => ({
      id: route.code,
      name: route.name,
      color: route.displayColor,
      grade: route.grade,
    })),
    placements: activeVersions.flatMap(({ route, version }) =>
      (version?.placements ?? []).map((placement) => ({
        id: placement.id,
        assetId: placement.demoAssetKey ?? placement.holdVariantId!,
        routeId: route.code,
        holeId: placement.wallHole.code,
        role: placement.role,
        rotationDegrees: placement.rotationDegrees,
      })),
    ),
    updatedAt: updatedAt.toISOString(),
  };
}
