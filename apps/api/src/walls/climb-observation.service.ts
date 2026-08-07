import { ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { ClimbObservationSource, type Prisma } from '@prisma/client';
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
      orderBy: { observedAt: 'asc' },
      take: 10_000,
      include: { route: { select: { code: true } } },
    });
    return observations.map(mapObservation);
  }

  async create(session: CurrentSession, input: CreateObservationInput) {
    this.access.assert(session, Capability.ASSET_DRAFT_WRITE);
    return this.prisma.$transaction(async (transaction) => {
      await lockHoldOrganization(transaction, session.organization.id);
      const replay = await findReplay(transaction, session.organization.id, input);
      if (replay) return mapObservation(replay);
      const route = await findRoute(transaction, session.organization.id, input);
      const observation = await transaction.climbObservation.create({
        data: {
          organizationId: session.organization.id,
          wallSegmentId: route.wallSegmentId,
          routeId: route.id,
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
            routeId: route.id,
            source: ClimbObservationSource.MANUAL,
            result: input.outcome,
          },
        },
        transaction,
      );
      return mapObservation(observation);
    });
  }
}

function observationFilter(organizationId: string, input: ListObservationsInput) {
  return {
    organizationId,
    wallSegment: { code: input.wallCode, organizationId },
    route: input.routeId ? { code: input.routeId, organizationId } : undefined,
    observedAt:
      input.from || input.to
        ? {
            gte: input.from ? new Date(input.from) : undefined,
            lt: input.to ? new Date(input.to) : undefined,
          }
        : undefined,
  } satisfies Prisma.ClimbObservationWhereInput;
}

async function findReplay(
  transaction: Prisma.TransactionClient,
  organizationId: string,
  input: CreateObservationInput,
) {
  const existing = await transaction.climbObservation.findUnique({
    where: { organizationId_requestKey: { organizationId, requestKey: input.requestKey } },
    include: { route: { select: { code: true } }, wallSegment: { select: { code: true } } },
  });
  if (!existing) return null;
  if (
    existing.route.code !== input.routeId ||
    existing.wallSegment.code !== input.wallCode ||
    existing.outcome !== input.outcome ||
    existing.observedAt.toISOString() !== new Date(input.observedAt).toISOString() ||
    (existing.climberKey ?? undefined) !== input.climberKey
  ) {
    throw new ConflictException('请求标识已用于其他攀爬事件');
  }
  return existing;
}

async function findRoute(
  transaction: Prisma.TransactionClient,
  organizationId: string,
  input: CreateObservationInput,
) {
  const route = await transaction.route.findFirst({
    where: {
      organizationId,
      code: input.routeId,
      wallSegment: { code: input.wallCode, organizationId },
    },
  });
  if (!route) throw new NotFoundException('线路不存在或不属于该墙面');
  return route;
}

function mapObservation(observation: {
  id: string;
  outcome: string;
  source: string;
  observedAt: Date;
  climberKey: string | null;
  route: { code: string };
}) {
  return {
    id: observation.id,
    routeId: observation.route.code,
    outcome: observation.outcome,
    source: observation.source,
    observedAt: observation.observedAt.toISOString(),
    climberKey: observation.climberKey ?? undefined,
  };
}
