import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import {
  MembershipStatus,
  type ClimbingColor,
  RoutePublicLinkStatus,
  RouteStatus,
  RouteVisualAnnotationStatus,
  RouteVersionStatus,
  WallStatus,
  type Prisma,
} from '@prisma/client';
import { randomUUID } from 'node:crypto';
import type { CurrentSession } from '../auth/session.service';
import { AuditService } from '../common/audit.service';
import { PrismaService } from '../database/prisma.service';
import { AccessControlService, Capability } from '../security/access-control.service';
import { TokenService } from '../security/token.service';
import { lockHoldOrganization } from '../holds/hold-transaction-lock';
import type {
  AnalyticsQueryInput,
  CreateRouteInput,
  CreateWallInput,
  ListRoutesInput,
  UpdateRouteInput,
} from './route-operations.dto';

const routeInclude = {
  versions: {
    orderBy: { versionNumber: 'desc' as const },
    include: {
      setter: { select: { id: true, displayName: true, jobTitle: true } },
      wallSegments: {
        orderBy: { ordinal: 'asc' as const },
        include: {
          wallSegment: { select: { id: true, code: true, name: true } },
        },
      },
      photo: { select: { id: true } },
      visualAnnotations: {
        where: { status: RouteVisualAnnotationStatus.CONFIRMED },
        select: { id: true },
        take: 1,
      },
      _count: { select: { placements: true } },
    },
  },
  publicLinks: {
    where: { status: RoutePublicLinkStatus.ACTIVE },
    orderBy: { createdAt: 'desc' as const },
    take: 1,
  },
  _count: { select: { feedback: true, climbObservations: true } },
} satisfies Prisma.RouteInclude;

type RouteRecord = Prisma.RouteGetPayload<{ include: typeof routeInclude }>;

@Injectable()
export class RouteOperationsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly access: AccessControlService,
    private readonly tokens: TokenService,
  ) {}

  async context(session: CurrentSession) {
    this.access.assert(session, Capability.ASSET_READ);
    const [areas, setters] = await this.prisma.$transaction([
      this.prisma.wallArea.findMany({
        where: { organizationId: session.organization.id, status: WallStatus.ACTIVE },
        orderBy: { code: 'asc' },
        include: {
          segments: {
            where: { status: WallStatus.ACTIVE },
            orderBy: { code: 'asc' },
            select: { id: true, code: true, name: true },
          },
        },
      }),
      this.prisma.membership.findMany({
        where: {
          organizationId: session.organization.id,
          status: MembershipStatus.ACTIVE,
        },
        orderBy: [{ displayName: 'asc' }, { createdAt: 'asc' }],
        select: { id: true, displayName: true, jobTitle: true },
      }),
    ]);
    return {
      areas: areas.map((area) => ({
        id: area.id,
        code: area.code,
        name: area.name,
        floorLabel: area.floorLabel,
        segments: area.segments,
      })),
      setters,
    };
  }

  async createWall(session: CurrentSession, input: CreateWallInput) {
    this.access.assert(session, Capability.ASSET_DRAFT_WRITE);
    const segment = await this.prisma.$transaction(async (transaction) => {
      await lockHoldOrganization(transaction, session.organization.id);
      const area = await transaction.wallArea.upsert({
        where: {
          organizationId_code: {
            organizationId: session.organization.id,
            code: input.areaCode,
          },
        },
        create: {
          organizationId: session.organization.id,
          code: input.areaCode,
          name: input.areaName,
          floorLabel: input.floorLabel || null,
        },
        update: {
          name: input.areaName,
          floorLabel: input.floorLabel || null,
          status: WallStatus.ACTIVE,
        },
      });
      const created = await transaction.wallSegment.create({
        data: {
          organizationId: session.organization.id,
          areaId: area.id,
          code: input.segmentCode,
          name: input.segmentName,
        },
        select: { id: true, code: true, name: true },
      });
      await this.audit.record(
        {
          organizationId: session.organization.id,
          actorAccountId: session.account.id,
          type: 'route_wall.created',
          outcome: 'SUCCESS',
          metadata: { areaId: area.id, wallSegmentId: created.id },
        },
        transaction,
      );
      return { ...created, area: { id: area.id, code: area.code, name: area.name } };
    });
    return segment;
  }

  async list(session: CurrentSession, input: ListRoutesInput) {
    this.access.assert(session, Capability.ASSET_READ);
    const routes = await this.prisma.route.findMany({
      where: {
        organizationId: session.organization.id,
        status: input.status,
        versions: input.wallSegmentId
          ? { some: { wallSegments: { some: { wallSegmentId: input.wallSegmentId } } } }
          : undefined,
      },
      orderBy: [{ status: 'asc' }, { updatedAt: 'desc' }],
      include: routeInclude,
    });
    return { items: routes.map((route) => this.mapRoute(route)) };
  }

  async get(session: CurrentSession, routeId: string) {
    this.access.assert(session, Capability.ASSET_READ);
    return this.mapRoute(await this.findRoute(session.organization.id, routeId));
  }

  async create(session: CurrentSession, input: CreateRouteInput) {
    this.access.assert(session, Capability.ASSET_DRAFT_WRITE);
    const routeId = await this.prisma.$transaction(async (transaction) => {
      await lockHoldOrganization(transaction, session.organization.id);
      await assertRouteContext(transaction, session.organization.id, input);
      const route = await transaction.route.create({
        data: {
          organizationId: session.organization.id,
          code: input.code,
          name: input.name,
          color: input.color,
          grade: input.grade,
          description: input.description || null,
          expectedRetireAt: toDate(input.expectedRetireAt),
          status: RouteStatus.DRAFT,
        },
      });
      const version = await transaction.routeVersion.create({
        data: {
          organizationId: session.organization.id,
          routeId: route.id,
          versionNumber: 1,
          color: input.color,
          grade: input.grade,
          gradeSystem: input.gradeSystem,
          styleTags: input.styleTags,
          setterMembershipId: input.setterMembershipId || null,
          createdByAccountId: session.account.id,
        },
      });
      await transaction.routeVersionWallSegment.createMany({
        data: input.wallSegmentIds.map((wallSegmentId, ordinal) => ({
          organizationId: session.organization.id,
          routeVersionId: version.id,
          wallSegmentId,
          geometryVersionId: null,
          ordinal,
        })),
      });
      await this.audit.record(
        {
          organizationId: session.organization.id,
          actorAccountId: session.account.id,
          type: 'route.created',
          outcome: 'SUCCESS',
          metadata: { routeId: route.id, routeVersionId: version.id, code: route.code },
        },
        transaction,
      );
      return route.id;
    });
    return this.get(session, routeId);
  }

  async update(session: CurrentSession, routeId: string, input: UpdateRouteInput) {
    this.access.assert(session, Capability.ASSET_DRAFT_WRITE);
    await this.prisma.$transaction(async (transaction) => {
      await lockHoldOrganization(transaction, session.organization.id);
      const route = await findDraftRoute(transaction, session.organization.id, routeId);
      const version = route.versions[0];
      if (!version || version.settingJobId || version._count.placements > 0) {
        throw new ConflictException('历史三维定线草稿已停止维护，请新建线路档案');
      }
      await assertRouteContext(transaction, session.organization.id, {
        setterMembershipId:
          input.setterMembershipId === undefined
            ? version.setterMembershipId
            : input.setterMembershipId,
        wallSegmentIds:
          input.wallSegmentIds ?? version.wallSegments.map((item) => item.wallSegmentId),
      });
      await transaction.route.update({
        where: { id: route.id },
        data: {
          code: input.code,
          name: input.name,
          color: input.color,
          grade: input.grade,
          description: input.description === undefined ? undefined : input.description || null,
          expectedRetireAt:
            input.expectedRetireAt === undefined ? undefined : toDate(input.expectedRetireAt),
        },
      });
      await transaction.routeVersion.update({
        where: { id: version.id },
        data: {
          color: input.color,
          grade: input.grade,
          gradeSystem: input.gradeSystem,
          styleTags: input.styleTags,
          setterMembershipId:
            input.setterMembershipId === undefined ? undefined : input.setterMembershipId || null,
        },
      });
      if (input.wallSegmentIds) {
        await transaction.routeVersionWallSegment.deleteMany({
          where: { routeVersionId: version.id },
        });
        await transaction.routeVersionWallSegment.createMany({
          data: input.wallSegmentIds.map((wallSegmentId, ordinal) => ({
            organizationId: session.organization.id,
            routeVersionId: version.id,
            wallSegmentId,
            geometryVersionId: null,
            ordinal,
          })),
        });
      }
      await this.audit.record(
        {
          organizationId: session.organization.id,
          actorAccountId: session.account.id,
          type: 'route.updated',
          outcome: 'SUCCESS',
          metadata: { routeId: route.id, routeVersionId: version.id },
        },
        transaction,
      );
    });
    return this.get(session, routeId);
  }

  async publish(session: CurrentSession, routeId: string) {
    this.access.assert(session, Capability.ASSET_PUBLISH);
    await this.prisma.$transaction(async (transaction) => {
      await lockHoldOrganization(transaction, session.organization.id);
      const route = await findDraftRoute(transaction, session.organization.id, routeId);
      const version = route.versions[0];
      if (!version?.wallSegments.length) throw new BadRequestException('线路至少需要关联一个墙段');
      const now = new Date();
      await transaction.route.update({
        where: { id: route.id },
        data: { status: RouteStatus.PUBLISHED, publishedAt: now, retiredAt: null },
      });
      await transaction.routeVersion.update({
        where: { id: version.id },
        data: { status: RouteVersionStatus.PUBLISHED, publishedAt: now, retiredAt: null },
      });
      const active = await transaction.routePublicLink.findFirst({
        where: {
          organizationId: session.organization.id,
          routeId,
          status: RoutePublicLinkStatus.ACTIVE,
        },
      });
      if (!active) {
        const linkId = randomUUID();
        const token = this.tokens.issuePublicRouteToken(linkId);
        await transaction.routePublicLink.create({
          data: {
            id: linkId,
            organizationId: session.organization.id,
            routeId,
            tokenHash: this.tokens.hash(token),
            activeRouteKey: routeId,
            createdByAccountId: session.account.id,
          },
        });
      }
      await this.audit.record(
        {
          organizationId: session.organization.id,
          actorAccountId: session.account.id,
          type: 'route.published',
          outcome: 'SUCCESS',
          metadata: { routeId: route.id, routeVersionId: version.id },
        },
        transaction,
      );
    });
    return this.get(session, routeId);
  }

  async retire(session: CurrentSession, routeId: string) {
    this.access.assert(session, Capability.ASSET_PUBLISH);
    await this.prisma.$transaction(async (transaction) => {
      await lockHoldOrganization(transaction, session.organization.id);
      const route = await transaction.route.findFirst({
        where: {
          id: routeId,
          organizationId: session.organization.id,
          status: RouteStatus.PUBLISHED,
        },
        include: {
          versions: {
            where: { status: RouteVersionStatus.PUBLISHED },
            orderBy: { versionNumber: 'desc' },
            take: 1,
          },
        },
      });
      if (!route?.versions[0]) throw new NotFoundException('可下线的已发布线路不存在');
      const now = new Date();
      await transaction.route.update({
        where: { id: route.id },
        data: { status: RouteStatus.REMOVED, retiredAt: now },
      });
      await transaction.routeVersion.update({
        where: { id: route.versions[0].id },
        data: { status: RouteVersionStatus.RETIRED, retiredAt: now },
      });
      await transaction.routePublicLink.updateMany({
        where: {
          organizationId: session.organization.id,
          routeId,
          status: RoutePublicLinkStatus.ACTIVE,
        },
        data: { status: RoutePublicLinkStatus.REVOKED, activeRouteKey: null, revokedAt: now },
      });
      await this.audit.record(
        {
          organizationId: session.organization.id,
          actorAccountId: session.account.id,
          type: 'route.retired',
          outcome: 'SUCCESS',
          metadata: { routeId: route.id, routeVersionId: route.versions[0].id },
        },
        transaction,
      );
    });
    return this.get(session, routeId);
  }

  async analytics(session: CurrentSession, input: AnalyticsQueryInput) {
    this.access.assert(session, Capability.ASSET_READ);
    const routes = await this.prisma.route.findMany({
      where: {
        organizationId: session.organization.id,
        status: { in: [RouteStatus.PUBLISHED, RouteStatus.REMOVED] },
        versions: input.wallSegmentId
          ? { some: { wallSegments: { some: { wallSegmentId: input.wallSegmentId } } } }
          : undefined,
      },
      orderBy: { publishedAt: 'desc' },
      include: {
        versions: {
          orderBy: { versionNumber: 'desc' },
          include: {
            wallSegments: {
              include: { wallSegment: { select: { id: true, code: true, name: true } } },
            },
            feedback: {
              where: {
                submittedAt:
                  input.from || input.to
                    ? {
                        gte: input.from ? new Date(input.from) : undefined,
                        lt: input.to ? new Date(input.to) : undefined,
                      }
                    : undefined,
              },
              select: {
                outcome: true,
                difficulty: true,
                enjoyment: true,
                safetyConcern: true,
                submittedAt: true,
              },
            },
          },
        },
      },
    });
    const items = routes.flatMap((route) =>
      route.versions
        .filter((version) => version.status !== RouteVersionStatus.DRAFT)
        .map((version) => analyticsItem(route, version)),
    );
    return {
      scope: {
        from: input.from ?? null,
        to: input.to ?? null,
        metricNotice: '二维码数据只代表主动反馈样本，不等于全馆真实尝试次数或真实完攀率。',
      },
      totals: {
        activeRoutes: routes.filter((route) => route.status === RouteStatus.PUBLISHED).length,
        routeVersions: items.length,
        feedback: items.reduce((sum, item) => sum + item.sampleSize, 0),
        safetyConcerns: items.reduce((sum, item) => sum + item.safetyConcernCount, 0),
      },
      items,
    };
  }

  private async findRoute(organizationId: string, routeId: string): Promise<RouteRecord> {
    const route = await this.prisma.route.findFirst({
      where: { id: routeId, organizationId },
      include: routeInclude,
    });
    if (!route) throw new NotFoundException('线路不存在');
    return route;
  }

  private mapRoute(route: RouteRecord) {
    const version =
      route.versions.find((candidate) =>
        route.status === RouteStatus.PUBLISHED
          ? candidate.status === RouteVersionStatus.PUBLISHED
          : route.status === RouteStatus.REMOVED
            ? candidate.status === RouteVersionStatus.RETIRED
            : candidate.status === RouteVersionStatus.DRAFT,
      ) ?? route.versions[0];
    const publicLink = route.publicLinks[0];
    return {
      id: route.id,
      code: route.code,
      name: route.name,
      description: route.description,
      status: route.status,
      dataSource: route.dataSource,
      color: version?.color ?? route.color,
      grade: version?.grade ?? route.grade,
      gradeSystem: version?.gradeSystem ?? null,
      styleTags: version?.styleTags ?? [],
      setter: version?.setter ?? null,
      wallSegments:
        version?.wallSegments.map((item) => ({
          ...item.wallSegment,
          geometryCalibrated: item.geometryVersionId !== null,
        })) ?? [],
      version: version
        ? {
            id: version.id,
            number: version.versionNumber,
            status: version.status,
            hasPhoto: Boolean(version.photo),
            has3dPlacements: version._count.placements > 0,
            hasVisualAnnotation: (version.visualAnnotations?.length ?? 0) > 0,
          }
        : null,
      expectedRetireAt: route.expectedRetireAt?.toISOString() ?? null,
      publishedAt: route.publishedAt?.toISOString() ?? null,
      retiredAt: route.retiredAt?.toISOString() ?? null,
      feedbackCount: route._count.feedback,
      observationCount: route._count.climbObservations,
      publicToken: publicLink ? this.tokens.issuePublicRouteToken(publicLink.id) : null,
      updatedAt: route.updatedAt.toISOString(),
      actions: {
        canEdit: route.status === RouteStatus.DRAFT && !version?.settingJobId,
        canPublish: route.status === RouteStatus.DRAFT && Boolean(version?.wallSegments.length),
        canRetire: route.status === RouteStatus.PUBLISHED,
      },
    };
  }
}

async function assertRouteContext(
  transaction: Prisma.TransactionClient,
  organizationId: string,
  input: { setterMembershipId?: string | null; wallSegmentIds: string[] },
) {
  const walls = await transaction.wallSegment.findMany({
    where: {
      id: { in: input.wallSegmentIds },
      organizationId,
      status: WallStatus.ACTIVE,
    },
    select: { id: true, areaId: true },
  });
  if (walls.length !== input.wallSegmentIds.length) {
    throw new BadRequestException('墙段不存在或不可用');
  }
  if (new Set(walls.map((wall) => wall.areaId)).size > 1) {
    throw new BadRequestException('一条线路只能跨同一墙区内的相邻墙段');
  }
  if (input.wallSegmentIds.length > 1) {
    const adjacencies = await transaction.wallSegmentAdjacency.findMany({
      where: {
        organizationId,
        areaId: walls[0]!.areaId,
        OR: input.wallSegmentIds.slice(0, -1).map((wallId, index) => ({
          OR: [
            { segmentAId: wallId, segmentBId: input.wallSegmentIds[index + 1] },
            { segmentAId: input.wallSegmentIds[index + 1], segmentBId: wallId },
          ],
        })),
      },
      select: { segmentAId: true, segmentBId: true },
    });
    const adjacent = new Set(
      adjacencies.map(({ segmentAId, segmentBId }) => [segmentAId, segmentBId].sort().join(':')),
    );
    const everyPairIsAdjacent = input.wallSegmentIds
      .slice(0, -1)
      .every((wallId, index) =>
        adjacent.has([wallId, input.wallSegmentIds[index + 1]!].sort().join(':')),
      );
    if (!everyPairIsAdjacent) {
      throw new BadRequestException('跨墙线路必须按顺序关联同一墙区内的相邻墙段');
    }
  }
  if (!input.setterMembershipId) return;
  const setter = await transaction.membership.findFirst({
    where: {
      id: input.setterMembershipId,
      organizationId,
      status: MembershipStatus.ACTIVE,
    },
    select: { id: true },
  });
  if (!setter) throw new BadRequestException('定线员不存在或不可用');
}

async function findDraftRoute(
  transaction: Prisma.TransactionClient,
  organizationId: string,
  routeId: string,
) {
  const route = await transaction.route.findFirst({
    where: { id: routeId, organizationId, status: RouteStatus.DRAFT },
    include: {
      versions: {
        where: { status: RouteVersionStatus.DRAFT },
        orderBy: { versionNumber: 'desc' },
        take: 1,
        include: {
          wallSegments: { orderBy: { ordinal: 'asc' } },
          _count: { select: { placements: true } },
        },
      },
    },
  });
  if (!route) throw new NotFoundException('可编辑的线路草稿不存在');
  return route;
}

function toDate(value: string | null | undefined): Date | null | undefined {
  return value === undefined ? undefined : value ? new Date(value) : null;
}

function analyticsItem(
  route: {
    id: string;
    code: string;
    name: string;
    status: RouteStatus;
    publishedAt: Date | null;
    retiredAt: Date | null;
  },
  version: {
    id: string;
    versionNumber: number;
    grade: string | null;
    color: ClimbingColor | null;
    wallSegments: Array<{ wallSegment: { id: string; code: string; name: string } }>;
    feedback: Array<{
      outcome: string;
      difficulty: string;
      enjoyment: string;
      safetyConcern: boolean;
      submittedAt: Date;
    }>;
  },
) {
  const sampleSize = version.feedback.length;
  const count = (field: 'outcome' | 'difficulty' | 'enjoyment', value: string) =>
    version.feedback.filter((feedback) => feedback[field] === value).length;
  const completed = count('outcome', 'COMPLETED');
  const easier = count('difficulty', 'EASIER');
  const expected = count('difficulty', 'AS_EXPECTED');
  const harder = count('difficulty', 'HARDER');
  const likes = count('enjoyment', 'LIKE');
  const safetyConcernCount = version.feedback.filter((feedback) => feedback.safetyConcern).length;
  const percentage = (value: number) =>
    sampleSize ? Math.round((value / sampleSize) * 1000) / 10 : null;
  return {
    routeId: route.id,
    routeCode: route.code,
    routeName: route.name,
    routeStatus: route.status,
    routeVersionId: version.id,
    versionNumber: version.versionNumber,
    grade: version.grade,
    color: version.color,
    wallSegments: version.wallSegments.map((item) => item.wallSegment),
    publishedAt: route.publishedAt?.toISOString() ?? null,
    retiredAt: route.retiredAt?.toISOString() ?? null,
    sampleSize,
    respondentCompletionRate: percentage(completed),
    difficulty: { easier, expected, harder, expectedRate: percentage(expected) },
    enjoyment: { likes, likeRate: percentage(likes) },
    safetyConcernCount,
    confidence:
      sampleSize >= 20 ? 'SUFFICIENT' : sampleSize >= 10 ? 'EARLY_SIGNAL' : 'INSUFFICIENT',
    recommendation: recommendation(
      sampleSize,
      safetyConcernCount,
      percentage(easier),
      percentage(harder),
      percentage(likes),
    ),
  };
}

function recommendation(
  sampleSize: number,
  safetyConcernCount: number,
  easierRate: number | null,
  harderRate: number | null,
  likeRate: number | null,
) {
  if (safetyConcernCount > 0) return { code: 'SAFETY_REVIEW', label: '优先复核安全反馈' };
  if (sampleSize < 10) return { code: 'COLLECT_MORE', label: '样本不足，继续收集' };
  if ((harderRate ?? 0) >= 40) return { code: 'REVIEW_HARDER', label: '复核难度是否偏高' };
  if ((easierRate ?? 0) >= 40) return { code: 'REVIEW_EASIER', label: '复核难度是否偏低' };
  if ((likeRate ?? 100) < 30) return { code: 'REVIEW_EXPERIENCE', label: '复盘线路体验' };
  return { code: 'KEEP', label: '当前表现稳定，可保留' };
}
