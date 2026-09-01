import {
  BadRequestException,
  Injectable,
  NotFoundException,
  ServiceUnavailableException,
} from '@nestjs/common';
import {
  ClimbObservationSource,
  RouteStatus,
  RouteVersionStatus,
  type Prisma,
} from '@prisma/client';
import type { CurrentSession } from '../auth/session.service';
import { AuditService } from '../common/audit.service';
import { AppConfigService } from '../config/app-config.service';
import { PrismaService } from '../database/prisma.service';
import { AccessControlService, Capability } from '../security/access-control.service';
import type {
  CreateCameraObservationInput,
  ListCameraObservationsInput,
} from './camera-observation.dto';

const observationInclude = {
  route: { select: { id: true, code: true, name: true, color: true } },
  routeVersion: { select: { id: true, versionNumber: true } },
  wallSegment: { select: { id: true, code: true, name: true } },
} satisfies Prisma.ClimbObservationInclude;

type ObservationRecord = Prisma.ClimbObservationGetPayload<{
  include: typeof observationInclude;
}>;

@Injectable()
export class CameraObservationService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly access: AccessControlService,
    private readonly config: AppConfigService,
  ) {}

  async list(session: CurrentSession, input: ListCameraObservationsInput) {
    this.access.assert(session, Capability.ASSET_READ);
    const observations = await this.prisma.climbObservation.findMany({
      where: {
        organizationId: session.organization.id,
        source: ClimbObservationSource.CAMERA,
      },
      orderBy: [{ observedAt: 'desc' }, { createdAt: 'desc' }],
      take: input.pageSize,
      include: observationInclude,
    });
    return { items: observations.map(mapObservation) };
  }

  async create(session: CurrentSession, input: CreateCameraObservationInput) {
    this.access.assert(session, Capability.ASSET_DRAFT_WRITE);
    return this.createForOrganization(input, session.organization.id, session.account.id);
  }

  async createFromWorker(input: CreateCameraObservationInput) {
    const organizationId = this.config.values.CAMERA_WORKER_ORGANIZATION_ID;
    if (!organizationId) {
      throw new ServiceUnavailableException('摄像头 Worker 尚未绑定组织');
    }
    return this.createForOrganization(input, organizationId);
  }

  private async createForOrganization(
    input: CreateCameraObservationInput,
    expectedOrganizationId?: string,
    actorAccountId?: string,
  ) {
    const observation = await this.prisma.$transaction(async (transaction) => {
      const version = await transaction.routeVersion.findFirst({
        where: {
          id: input.routeVersionId,
          routeId: input.routeId,
          ...(expectedOrganizationId ? { organizationId: expectedOrganizationId } : {}),
          status: RouteVersionStatus.PUBLISHED,
          route: { status: RouteStatus.PUBLISHED },
        },
        select: {
          id: true,
          organizationId: true,
          wallSegments: { select: { wallSegmentId: true } },
        },
      });
      if (!version) throw new NotFoundException('线路版本不存在');

      const existing = await transaction.climbObservation.findUnique({
        where: {
          organizationId_requestKey: {
            organizationId: version.organizationId,
            requestKey: input.requestKey,
          },
        },
        include: observationInclude,
      });
      if (existing) return existing;

      if (
        input.wallSegmentId &&
        !version.wallSegments.some((item) => item.wallSegmentId === input.wallSegmentId)
      ) {
        throw new BadRequestException('观察墙段不属于该线路版本');
      }

      const created = await transaction.climbObservation.create({
        data: {
          organizationId: version.organizationId,
          wallSegmentId: input.wallSegmentId,
          routeId: input.routeId,
          routeVersionId: input.routeVersionId,
          outcome: input.analysis.outcome,
          source: ClimbObservationSource.CAMERA,
          observedAt: new Date(input.observedAt),
          climberKey: input.climberKey,
          requestKey: input.requestKey,
          metadata: toMetadata(input),
        },
        include: observationInclude,
      });
      await this.audit.record(
        {
          organizationId: version.organizationId,
          actorAccountId,
          type: 'camera.observation.created',
          outcome: 'SUCCESS',
          metadata: {
            observationId: created.id,
            routeId: input.routeId,
            routeVersionId: input.routeVersionId,
            attemptId: input.analysis.attemptId,
          },
        },
        transaction,
      );
      return created;
    });
    return mapObservation(observation);
  }
}

function toMetadata(input: CreateCameraObservationInput): Prisma.InputJsonObject {
  return {
    schemaVersion: input.analysis.schemaVersion,
    attemptId: input.analysis.attemptId,
    modelVersion: input.analysis.modelVersion,
    calibrationId: input.analysis.calibrationId,
    failureReasons: input.analysis.failureReasons,
    confidence: input.analysis.confidence,
    requiresReview: input.analysis.requiresReview,
    startedAtS: input.analysis.startedAtS ?? undefined,
    finishReachedAtS: input.analysis.finishReachedAtS ?? undefined,
    fallAtS: input.analysis.fallAtS ?? undefined,
    events: input.analysis.events,
  };
}

function mapObservation(observation: ObservationRecord) {
  return {
    id: observation.id,
    outcome: observation.outcome,
    observedAt: observation.observedAt.toISOString(),
    source: observation.source,
    climberKey: observation.climberKey,
    route: observation.route,
    routeVersion: observation.routeVersion,
    wallSegment: observation.wallSegment,
    analysis: observation.metadata,
  };
}
