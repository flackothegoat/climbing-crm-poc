import { ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { ClimbObservationSource, RouteVersionStatus, type Prisma } from '@prisma/client';
import type { CurrentSession } from '../auth/session.service';
import { AuditService } from '../common/audit.service';
import { PrismaService } from '../database/prisma.service';
import { lockHoldOrganization } from '../holds/hold-transaction-lock';
import { AccessControlService, Capability } from '../security/access-control.service';
import type { CreateObservationInput, ListObservationsInput } from './wall-route.dto';

@Injectable()
export class ClimbObservationService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly access: AccessControlService,
  ) {}

  async list(session: CurrentSession, input: ListObservationsInput) {
    this.access.assert(session, Capability.ASSET_READ);
    const observations = await this.prisma.climbObservation.findMany({
      where: observationFilter(session.organization.id, input),
      orderBy: [{ observedAt: 'desc' }, { id: 'desc' }],
      take: input.limit + 1,
      ...(input.cursor ? { cursor: { id: input.cursor }, skip: 1 } : {}),
      include: { route: { select: { code: true } } },
    });
    const hasMore = observations.length > input.limit;
    const page = hasMore ? observations.slice(0, input.limit) : observations;
    return {
      items: page.map(mapObservation),
      nextCursor: hasMore ? page.at(-1)!.id : null,
    };
  }

  async create(session: CurrentSession, input: CreateObservationInput) {
    this.access.assert(session, Capability.ASSET_DRAFT_WRITE);
    return this.prisma.$transaction(async (transaction) => {
      await lockHoldOrganization(transaction, session.organization.id);
      const replay = await findReplay(transaction, session.organization.id, input);
      if (replay) return mapObservation(replay);
      const context = await findRouteVersion(transaction, session.organization.id, input);
      const observation = await transaction.climbObservation.create({
        data: {
          organizationId: session.organization.id,
          wallSegmentId: context.wallSegmentId,
          routeId: context.routeId,
          routeVersionId: context.routeVersionId,
          outcome: input.outcome,
          source: ClimbObservationSource.MANUAL,
          observedAt: new Date(input.observedAt),
          climberKey: input.climberKey,
          requestKey: input.requestKey,
          createdByAccountId: session.account.id,
        },
        include: { route: { select: { code: true } } },
      });
      await this.audit.record(
        {
          organizationId: session.organization.id,
          actorAccountId: session.account.id,
          type: 'climb_observation.created',
          outcome: 'SUCCESS',
          metadata: {
            observationId: observation.id,
            routeId: context.routeId,
            routeVersionId: context.routeVersionId,
            source: ClimbObservationSource.MANUAL,
            result: input.outcome,
          },
        },
        transaction,
      );
      return mapObservation(observation);
    });
  }

  async summary(session: CurrentSession, input: ListObservationsInput) {
    this.access.assert(session, Capability.ASSET_READ);
    const grouped = await this.prisma.climbObservation.groupBy({
      by: ['routeId', 'outcome'],
      where: observationFilter(session.organization.id, input),
      _count: { _all: true },
    });
    const routeIds = [...new Set(grouped.map((item) => item.routeId))];
    const routes = await this.prisma.route.findMany({
      where: { id: { in: routeIds }, organizationId: session.organization.id },
      select: { id: true, code: true },
    });
    const routeCodes = new Map(routes.map((route) => [route.id, route.code]));
    return grouped.map((item) => ({
      routeId: routeCodes.get(item.routeId) ?? item.routeId,
      outcome: item.outcome,
      count: item._count._all,
    }));
  }
}

function observationFilter(
  organizationId: string,
  input: ListObservationsInput,
): Prisma.ClimbObservationWhereInput {
  return {
    organizationId,
    routeVersion: {
      wallSegments: {
        some: { wallSegment: { code: input.wallCode, organizationId } },
      },
    },
    route: input.routeId ? { code: input.routeId, organizationId } : undefined,
    observedAt:
      input.from || input.to
        ? {
            gte: input.from ? new Date(input.from) : undefined,
            lt: input.to ? new Date(input.to) : undefined,
          }
        : undefined,
  };
}

async function findReplay(
  transaction: Prisma.TransactionClient,
  organizationId: string,
  input: CreateObservationInput,
) {
  const existing = await transaction.climbObservation.findUnique({
    where: { organizationId_requestKey: { organizationId, requestKey: input.requestKey } },
    include: {
      route: { select: { code: true } },
      wallSegment: { select: { code: true } },
      routeVersion: { select: { id: true } },
    },
  });
  if (!existing) return null;
  if (
    existing.route.code !== input.routeId ||
    existing.wallSegment?.code !== input.wallCode ||
    existing.outcome !== input.outcome ||
    existing.observedAt.toISOString() !== new Date(input.observedAt).toISOString() ||
    (existing.climberKey ?? undefined) !== input.climberKey
  ) {
    throw new ConflictException('请求标识已用于其他攀爬事件');
  }
  return existing;
}

async function findRouteVersion(
  transaction: Prisma.TransactionClient,
  organizationId: string,
  input: CreateObservationInput,
) {
  const route = await transaction.route.findUnique({
    where: { organizationId_code: { organizationId, code: input.routeId } },
    include: {
      versions: {
        where: { status: { in: [RouteVersionStatus.PUBLISHED, RouteVersionStatus.DRAFT] } },
        orderBy: { versionNumber: 'desc' },
        include: {
          wallSegments: {
            where: { wallSegment: { code: input.wallCode, organizationId } },
            select: { wallSegmentId: true },
          },
        },
      },
    },
  });
  if (!route) throw new NotFoundException('线路不存在');
  const version =
    route.versions.find(
      (candidate) =>
        candidate.status === RouteVersionStatus.PUBLISHED && candidate.wallSegments.length > 0,
    ) ?? route.versions.find((candidate) => candidate.wallSegments.length > 0);
  const wallSegmentId = version?.wallSegments[0]?.wallSegmentId;
  if (!version || !wallSegmentId) throw new NotFoundException('线路版本不存在或不属于该墙面');
  return { routeId: route.id, routeVersionId: version.id, wallSegmentId };
}

function mapObservation(observation: {
  id: string;
  routeVersionId: string;
  outcome: string;
  source: string;
  observedAt: Date;
  climberKey: string | null;
  route: { code: string };
}) {
  return {
    id: observation.id,
    routeId: observation.route.code,
    routeVersionId: observation.routeVersionId,
    outcome: observation.outcome,
    source: observation.source,
    observedAt: observation.observedAt.toISOString(),
    climberKey: observation.climberKey ?? undefined,
  };
}
