import {
  BadRequestException,
  Injectable,
  NotFoundException,
  ServiceUnavailableException,
} from '@nestjs/common';
import {
  CameraObservationReviewDecision,
  CameraObservationReviewStatus,
  ClimbObservationOutcome,
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
  ReviewCameraObservationInput,
} from './camera-observation.dto';

const observationInclude = {
  route: { select: { id: true, code: true, name: true, color: true } },
  routeVersion: { select: { id: true, versionNumber: true } },
  wallSegment: { select: { id: true, code: true, name: true } },
  evidence: {
    select: {
      id: true,
      status: true,
      contentType: true,
      sizeBytes: true,
      durationMs: true,
      expiresAt: true,
      expiredAt: true,
    },
  },
  reviews: {
    orderBy: [{ createdAt: 'desc' as const }, { id: 'desc' as const }],
    take: 1,
    select: {
      id: true,
      decision: true,
      finalOutcome: true,
      comment: true,
      createdAt: true,
      reviewedBy: { select: { id: true, email: true } },
    },
  },
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
    if (
      input.observedFrom &&
      input.observedTo &&
      new Date(input.observedFrom) > new Date(input.observedTo)
    ) {
      throw new BadRequestException('识别开始时间不能晚于结束时间');
    }
    if (input.cursor) {
      const cursorExists = await this.prisma.climbObservation.findFirst({
        where: {
          id: input.cursor,
          organizationId: session.organization.id,
          source: ClimbObservationSource.CAMERA,
        },
        select: { id: true },
      });
      if (!cursorExists) throw new NotFoundException('识别结果分页位置不存在');
    }
    const where = observationWhere(session.organization.id, input);
    const observations = await this.prisma.climbObservation.findMany({
      where,
      orderBy: [{ observedAt: 'desc' }, { id: 'desc' }],
      cursor: input.cursor ? { id: input.cursor } : undefined,
      skip: input.cursor ? 1 : undefined,
      take: input.pageSize + 1,
      include: observationInclude,
    });
    const hasMore = observations.length > input.pageSize;
    if (hasMore) observations.pop();
    return {
      items: observations.map(mapObservation),
      nextCursor: hasMore ? (observations.at(-1)?.id ?? null) : null,
    };
  }

  async get(session: CurrentSession, observationId: string) {
    this.access.assert(session, Capability.ASSET_READ);
    const observation = await this.prisma.climbObservation.findFirst({
      where: {
        id: observationId,
        organizationId: session.organization.id,
        source: ClimbObservationSource.CAMERA,
      },
      include: observationInclude,
    });
    if (!observation) throw new NotFoundException('识别结果不存在');
    return mapObservation(observation);
  }

  async review(
    session: CurrentSession,
    observationId: string,
    input: ReviewCameraObservationInput,
  ) {
    this.access.assert(session, Capability.OBSERVATION_REVIEW);
    const result = await this.prisma.$transaction(async (transaction) => {
      const observation = await transaction.climbObservation.findFirst({
        where: {
          id: observationId,
          organizationId: session.organization.id,
          source: ClimbObservationSource.CAMERA,
        },
        select: { id: true, outcome: true },
      });
      if (!observation) throw new NotFoundException('识别结果不存在');
      const projection = reviewProjection(input.decision, observation.outcome);
      const review = await transaction.cameraObservationReview.create({
        data: {
          organizationId: session.organization.id,
          observationId,
          decision: input.decision,
          finalOutcome: projection.finalOutcome,
          comment: input.comment,
          reviewedByAccountId: session.account.id,
        },
      });
      await transaction.climbObservation.update({
        where: { id: observationId },
        data: { reviewStatus: projection.status },
      });
      await transaction.cameraObservationEvidence.updateMany({
        where: { observationId, status: 'AVAILABLE' },
        data: { expiresAt: new Date(Date.now() + projection.retentionMs) },
      });
      await this.audit.record(
        {
          organizationId: session.organization.id,
          actorAccountId: session.account.id,
          type: 'camera.observation.reviewed',
          outcome: 'SUCCESS',
          metadata: { observationId, reviewId: review.id, decision: input.decision },
        },
        transaction,
      );
      return transaction.climbObservation.findUniqueOrThrow({
        where: { id: observationId },
        include: observationInclude,
      });
    });
    return mapObservation(result);
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
    reviewStatus: observation.reviewStatus,
    route: observation.route,
    routeVersion: observation.routeVersion,
    wallSegment: observation.wallSegment,
    analysis: observation.metadata,
    evidence: observation.evidence
      ? {
          ...observation.evidence,
          expiresAt: observation.evidence.expiresAt.toISOString(),
          expiredAt: observation.evidence.expiredAt?.toISOString() ?? null,
        }
      : null,
    latestReview: observation.reviews[0]
      ? {
          ...observation.reviews[0],
          createdAt: observation.reviews[0].createdAt.toISOString(),
        }
      : null,
  };
}

function observationWhere(
  organizationId: string,
  input: ListCameraObservationsInput,
): Prisma.ClimbObservationWhereInput {
  const reviewStatus =
    input.reviewStatus && input.reviewStatus !== 'PENDING'
      ? CameraObservationReviewStatus[input.reviewStatus]
      : undefined;
  return {
    organizationId,
    source: ClimbObservationSource.CAMERA,
    routeId: input.routeId,
    outcome: input.outcome,
    reviewStatus:
      input.reviewStatus === 'PENDING' ? CameraObservationReviewStatus.UNREVIEWED : reviewStatus,
    observedAt:
      input.observedFrom || input.observedTo
        ? {
            gte: input.observedFrom ? new Date(input.observedFrom) : undefined,
            lte: input.observedTo ? new Date(input.observedTo) : undefined,
          }
        : undefined,
    metadata:
      input.reviewStatus === 'PENDING' ? { path: ['requiresReview'], equals: true } : undefined,
    OR: input.query
      ? [
          { route: { code: { contains: input.query, mode: 'insensitive' } } },
          { route: { name: { contains: input.query, mode: 'insensitive' } } },
        ]
      : undefined,
  };
}

function reviewProjection(
  decision: CameraObservationReviewDecision,
  originalOutcome: ClimbObservationOutcome,
) {
  const threeDays = 72 * 60 * 60 * 1_000;
  const thirtyDays = 30 * 24 * 60 * 60 * 1_000;
  if (decision === CameraObservationReviewDecision.CONFIRM) {
    return {
      status: CameraObservationReviewStatus.CONFIRMED,
      finalOutcome: originalOutcome,
      retentionMs: threeDays,
    };
  }
  if (decision === CameraObservationReviewDecision.INVALIDATE) {
    return {
      status: CameraObservationReviewStatus.INVALIDATED,
      finalOutcome: null,
      retentionMs: threeDays,
    };
  }
  return {
    status: CameraObservationReviewStatus.OVERRIDDEN,
    finalOutcome:
      decision === CameraObservationReviewDecision.OVERRIDE_COMPLETED
        ? ClimbObservationOutcome.COMPLETED
        : ClimbObservationOutcome.FAILED,
    retentionMs: thirtyDays,
  };
}
