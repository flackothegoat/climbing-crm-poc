import { ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import {
  PlacementAnchorRole,
  RouteDataSource,
  RouteStatus,
  RouteVersionStatus,
  WallGeometryVersionStatus,
  WallSettingJobStatus,
  type Prisma,
} from '@prisma/client';
import type { CurrentSession } from '../auth/session.service';
import { AuditService } from '../common/audit.service';
import { PrismaService } from '../database/prisma.service';
import { lockHoldOrganization } from '../holds/hold-transaction-lock';
import { AccessControlService, Capability } from '../security/access-control.service';
import type { SaveRouteSettingPlanInput } from './wall-route.dto';

const wallPlanInclude = {
  geometryVersions: {
    where: { status: WallGeometryVersionStatus.PUBLISHED },
    orderBy: { versionNumber: 'desc' as const },
    take: 1,
  },
  routeVersionSegments: {
    where: {
      routeVersion: { status: { in: [RouteVersionStatus.DRAFT, RouteVersionStatus.PUBLISHED] } },
    },
    include: {
      routeVersion: {
        include: {
          route: true,
          wallSegments: true,
          placements: {
            include: { wallHole: true, anchors: { orderBy: { ordinal: 'asc' as const } } },
            orderBy: { createdAt: 'asc' as const },
          },
        },
      },
    },
  },
} satisfies Prisma.WallSegmentInclude;

type WallWithRoutePlan = Prisma.WallSegmentGetPayload<{ include: typeof wallPlanInclude }>;
type PlanVersion = WallWithRoutePlan['routeVersionSegments'][number]['routeVersion'];

@Injectable()
export class RouteSettingService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly access: AccessControlService,
  ) {}

  async getPlan(session: CurrentSession, wallCode: string, settingJobId?: string) {
    this.access.assert(session, Capability.ASSET_READ);
    const wall = await this.prisma.wallSegment.findFirst({
      where: { organizationId: session.organization.id, code: wallCode },
      include: wallPlanInclude,
    });
    if (!wall) throw new NotFoundException('墙面定线数据尚未初始化');
    const job = settingJobId
      ? await findSettingJob(this.prisma, session.organization.id, settingJobId, wall.id)
      : undefined;
    return mapRoutePlan(wall, job);
  }

  async savePlan(session: CurrentSession, wallCode: string, input: SaveRouteSettingPlanInput) {
    this.access.assert(session, Capability.ASSET_DRAFT_WRITE);
    if (input.wall.code !== wallCode) throw new ConflictException('路径墙面与定线计划不一致');
    await this.prisma.$transaction(async (transaction) => {
      await lockHoldOrganization(transaction, session.organization.id);
      const wall = await findWall(transaction, session.organization.id, wallCode);
      const job = await findSettingJob(
        transaction,
        session.organization.id,
        input.settingJobId,
        wall.id,
      );
      if (job.status !== WallSettingJobStatus.DRAFT) {
        throw new ConflictException('已锁定或结束的定线任务不能修改草稿');
      }
      await claimPlanRevision(transaction, wall.id, input.revision);
      const geometry = await findPublishedGeometryVersion(
        transaction,
        session.organization.id,
        wall.id,
      );
      const holes = await findPlanHoles(
        transaction,
        session.organization.id,
        wall.id,
        geometry.id,
        input,
      );
      await assertFormalAssetsBelongToOrganization(transaction, session.organization.id, input);
      await removeOmittedDrafts(transaction, session.organization.id, wall.id, job.id, input);
      await saveRoutes(transaction, session, wall.id, geometry.id, job.id, holes, input);
      await this.audit.record(
        {
          organizationId: session.organization.id,
          actorAccountId: session.account.id,
          type: 'route.setting_plan.saved',
          outcome: 'SUCCESS',
          metadata: {
            wallSegmentId: wall.id,
            previousRevision: input.revision,
            routeCount: input.routes.length,
            placementCount: input.placements.length,
          },
        },
        transaction,
      );
    });
    return this.getPlan(session, wallCode, input.settingJobId);
  }
}

async function claimPlanRevision(
  transaction: Prisma.TransactionClient,
  wallSegmentId: string,
  expectedRevision: number,
): Promise<void> {
  const claimed = await transaction.wallSegment.updateMany({
    where: { id: wallSegmentId, routePlanRevision: expectedRevision },
    data: { routePlanRevision: { increment: 1 } },
  });
  if (!claimed.count) {
    throw new ConflictException('定线计划已被其他用户修改，请刷新后合并变更');
  }
}

async function findPublishedGeometryVersion(
  transaction: Prisma.TransactionClient,
  organizationId: string,
  wallSegmentId: string,
) {
  const geometry = await transaction.wallGeometryVersion.findFirst({
    where: { organizationId, wallSegmentId, status: WallGeometryVersionStatus.PUBLISHED },
    orderBy: { versionNumber: 'desc' },
  });
  if (!geometry) throw new ConflictException('墙面缺少可用的几何版本');
  return geometry;
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
  geometryVersionId: string,
  input: SaveRouteSettingPlanInput,
) {
  const requestedCodes = [...new Set(input.placements.map((placement) => placement.holeId))];
  if (!requestedCodes.length) return new Map<string, string>();
  const holes = await transaction.wallHole.findMany({
    where: { organizationId, wallSegmentId, geometryVersionId, code: { in: requestedCodes } },
    select: { id: true, code: true },
  });
  if (holes.length !== requestedCodes.length) throw new ConflictException('计划包含无效或跨墙孔位');
  return new Map(holes.map((hole) => [hole.code, hole.id]));
}

async function saveRoutes(
  transaction: Prisma.TransactionClient,
  session: CurrentSession,
  wallSegmentId: string,
  geometryVersionId: string,
  settingJobId: string,
  holes: Map<string, string>,
  input: SaveRouteSettingPlanInput,
) {
  for (const routeInput of input.routes) {
    const placements = input.placements.filter((item) => item.routeId === routeInput.id);
    const dataSource =
      placements.length > 0 && placements.every((item) => item.assetId.startsWith('test-'))
        ? RouteDataSource.DUMMY
        : RouteDataSource.MANUAL;
    const route = await upsertRoute(transaction, session.organization.id, routeInput, dataSource);
    const version = await findOrCreateDraftVersion(
      transaction,
      session,
      route.id,
      wallSegmentId,
      geometryVersionId,
      settingJobId,
      dataSource,
    );
    await replacePlacements(transaction, session.organization.id, version.id, holes, placements);
    await transaction.routeVersion.update({
      where: { id: version.id },
      data: { dataSource, updatedAt: new Date() },
    });
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
      status: 'ACTIVE',
      holdModel: { organizationId, status: 'ACTIVE' },
    },
  });
  if (count !== variantIds.length) throw new ConflictException('计划包含无效或跨岩馆岩点档案');
}

async function upsertRoute(
  transaction: Prisma.TransactionClient,
  organizationId: string,
  input: SaveRouteSettingPlanInput['routes'][number],
  dataSource: RouteDataSource,
) {
  const existing = await transaction.route.findUnique({
    where: { organizationId_code: { organizationId, code: input.id } },
  });
  if (existing) {
    if (existing.status === RouteStatus.REMOVED) {
      throw new ConflictException(`线路 ${input.id} 已被删除，请使用新的线路编号`);
    }
    return transaction.route.update({
      where: { id: existing.id },
      data: {
        name: input.name,
        displayColor: input.color,
        grade: input.grade,
        dataSource,
        status: existing.status === RouteStatus.INACTIVE ? RouteStatus.DRAFT : existing.status,
      },
    });
  }
  return transaction.route.create({
    data: {
      organizationId,
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
  wallSegmentId: string,
  geometryVersionId: string,
  settingJobId: string,
  dataSource: RouteDataSource,
) {
  const draft = await transaction.routeVersion.findFirst({
    where: {
      organizationId: session.organization.id,
      routeId,
      status: RouteVersionStatus.DRAFT,
      settingJobId,
    },
    include: { wallSegments: true },
    orderBy: { versionNumber: 'desc' },
  });
  if (draft) {
    if (draft.wallSegments.some((item) => item.wallSegmentId !== wallSegmentId)) {
      throw new ConflictException('跨墙段线路必须在整面墙定线任务中编辑');
    }
    await transaction.routeVersionWallSegment.upsert({
      where: { routeVersionId_wallSegmentId: { routeVersionId: draft.id, wallSegmentId } },
      create: {
        organizationId: session.organization.id,
        routeVersionId: draft.id,
        wallSegmentId,
        geometryVersionId,
        ordinal: 0,
      },
      update: { geometryVersionId },
    });
    return draft;
  }
  const latest = await transaction.routeVersion.findFirst({
    where: { organizationId: session.organization.id, routeId },
    include: { wallSegments: true },
    orderBy: { versionNumber: 'desc' },
  });
  if (latest && latest.wallSegments.some((item) => item.wallSegmentId !== wallSegmentId)) {
    throw new ConflictException('跨墙段线路必须在整面墙定线任务中创建新版本');
  }
  return transaction.routeVersion.create({
    data: {
      organizationId: session.organization.id,
      routeId,
      versionNumber: (latest?.versionNumber ?? 0) + 1,
      status: RouteVersionStatus.DRAFT,
      dataSource,
      note: dataSource === RouteDataSource.DUMMY ? '由 W06 演示计划保存。' : null,
      createdByAccountId: session.account.id,
      settingJobId,
      wallSegments: {
        create: {
          organizationId: session.organization.id,
          wallSegmentId,
          geometryVersionId,
          ordinal: 0,
        },
      },
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
  const existing = await transaction.routeHoldPlacement.findMany({
    where: { organizationId, routeVersionId },
    include: { installations: { where: { status: 'INSTALLED' }, select: { id: true } } },
  });
  if (existing.some((placement) => placement.installations.length > 0)) {
    throw new ConflictException('已有实际安装记录的线路版本不可覆盖，请创建新草稿版本');
  }
  const existingById = new Map(existing.map((placement) => [placement.id, placement]));
  const desiredIds = new Set(placements.map((placement) => placement.id));
  const removedIds = existing.filter((item) => !desiredIds.has(item.id)).map((item) => item.id);
  if (removedIds.length) {
    await transaction.routeHoldPlacementAnchor.deleteMany({
      where: { placementId: { in: removedIds } },
    });
    await transaction.routeHoldPlacement.deleteMany({
      where: { id: { in: removedIds }, routeVersionId },
    });
  }
  for (const placement of placements) {
    const isDummy = placement.assetId.startsWith('test-');
    const data = {
      wallHoleId: holes.get(placement.holeId)!,
      holdVariantId: isDummy ? null : placement.assetId,
      demoAssetKey: isDummy ? placement.assetId : null,
      role: placement.role,
      rotationDegrees: placement.rotationDegrees,
      dataSource: isDummy ? RouteDataSource.DUMMY : RouteDataSource.MANUAL,
    };
    if (existingById.has(placement.id)) {
      await transaction.routeHoldPlacement.update({
        where: { id: placement.id },
        data,
      });
    } else {
      await transaction.routeHoldPlacement.create({
        data: { id: placement.id, organizationId, routeVersionId, ...data },
      });
    }
    await transaction.routeHoldPlacementAnchor.deleteMany({ where: { placementId: placement.id } });
    await transaction.routeHoldPlacementAnchor.create({
      data: {
        organizationId,
        placementId: placement.id,
        wallHoleId: data.wallHoleId,
        role: PlacementAnchorRole.PRIMARY,
        ordinal: 0,
      },
    });
  }
}

async function removeOmittedDrafts(
  transaction: Prisma.TransactionClient,
  organizationId: string,
  wallSegmentId: string,
  settingJobId: string,
  input: SaveRouteSettingPlanInput,
) {
  const desiredCodes = new Set(input.routes.map((route) => route.id));
  const candidates = await transaction.routeVersionWallSegment.findMany({
    where: {
      organizationId,
      wallSegmentId,
      routeVersion: { status: RouteVersionStatus.DRAFT, settingJobId },
    },
    include: {
      routeVersion: {
        include: {
          route: true,
          wallSegments: true,
          installations: { where: { status: 'INSTALLED' }, select: { id: true } },
        },
      },
    },
  });
  for (const candidate of candidates) {
    const version = candidate.routeVersion;
    if (desiredCodes.has(version.route.code) || version.wallSegments.length !== 1) continue;
    if (version.installations.length) {
      throw new ConflictException(`线路 ${version.route.code} 已有实际安装，不能从草稿中直接移除`);
    }
    await transaction.routeVersion.update({
      where: { id: version.id },
      data: { status: RouteVersionStatus.RETIRED },
    });
    const remainingActiveVersions = await transaction.routeVersion.count({
      where: {
        routeId: version.routeId,
        status: { in: [RouteVersionStatus.DRAFT, RouteVersionStatus.PUBLISHED] },
      },
    });
    if (!remainingActiveVersions) {
      await transaction.route.update({
        where: { id: version.routeId },
        data: { status: RouteStatus.INACTIVE },
      });
    }
  }
}

function activeVersionsForWall(wall: WallWithRoutePlan, settingJobId?: string): PlanVersion[] {
  const byRoute = new Map<string, PlanVersion>();
  for (const segment of wall.routeVersionSegments) {
    const version = segment.routeVersion;
    if (
      settingJobId &&
      (version.settingJobId !== settingJobId || version.dataSource === RouteDataSource.DUMMY)
    ) {
      continue;
    }
    const current = byRoute.get(version.routeId);
    if (!current || versionPriority(version) > versionPriority(current)) {
      byRoute.set(version.routeId, version);
    }
  }
  return [...byRoute.values()].sort((a, b) => a.route.code.localeCompare(b.route.code));
}

function versionPriority(version: PlanVersion): number {
  const status = version.status === RouteVersionStatus.DRAFT ? 2 : 1;
  return status * 1_000_000 + version.versionNumber;
}

function mapRoutePlan(wall: WallWithRoutePlan, job?: SettingJobContext) {
  const geometry = wall.geometryVersions[0];
  if (!geometry) throw new ConflictException('墙面缺少已发布几何版本');
  const versions = activeVersionsForWall(wall, job?.id);
  const updatedAt = versions.reduce(
    (latest, version) => (version.updatedAt > latest ? version.updatedAt : latest),
    geometry.updatedAt,
  );
  return {
    schemaVersion: 1 as const,
    settingJobId: job?.id ?? '',
    settingJob: job ? { id: job.id, name: job.name, status: job.status } : null,
    persisted: true,
    revision: wall.routePlanRevision,
    dataSource: versions.some((version) => version.dataSource === RouteDataSource.DUMMY)
      ? ('DUMMY' as const)
      : ('MANUAL' as const),
    wall: {
      code: wall.code,
      name: wall.name,
      widthMm: geometry.widthMm,
      heightMm: geometry.heightMm,
      surfaceHeightMm: geometry.surfaceHeightMm ?? geometry.heightMm,
      angleFromVerticalDegrees: geometry.angleFromVerticalDegrees ?? 0,
    },
    calibration: {
      horizontalPitchMm: geometry.horizontalPitchMm ?? 200,
      verticalPitchMm: geometry.verticalPitchMm ?? 200,
      status:
        geometry.calibration === 'FIELD_CALIBRATED'
          ? ('FIELD_CALIBRATED' as const)
          : ('ESTIMATED_FROM_SCAN' as const),
      note:
        geometry.calibration === 'FIELD_CALIBRATED'
          ? '墙面孔位已经现场校准。'
          : '扫描测绘估算；正式使用前须现场复核原点、行列、缺失孔和边界孔。',
    },
    routes: versions.map((version) => ({
      id: version.route.code,
      name: version.route.name,
      color: version.route.displayColor,
      grade: version.route.grade,
    })),
    placements: versions.flatMap((version) =>
      version.placements
        .filter((placement) => placement.wallHole.wallSegmentId === wall.id)
        .map((placement) => ({
          id: placement.id,
          assetId: placement.demoAssetKey ?? placement.holdVariantId!,
          routeId: version.route.code,
          holeId: placement.wallHole.code,
          role: placement.role,
          rotationDegrees: placement.rotationDegrees,
        })),
    ),
    updatedAt: updatedAt.toISOString(),
  };
}

interface SettingJobContext {
  id: string;
  name: string;
  status: WallSettingJobStatus;
}

async function findSettingJob(
  client: PrismaService | Prisma.TransactionClient,
  organizationId: string,
  settingJobId: string,
  wallSegmentId: string,
): Promise<SettingJobContext> {
  const job = await client.wallSettingJob.findFirst({
    where: {
      id: settingJobId,
      organizationId,
      segments: { some: { wallSegmentId } },
    },
    select: { id: true, name: true, status: true },
  });
  if (!job) throw new NotFoundException('定线任务不存在或不属于当前墙面');
  return job;
}
