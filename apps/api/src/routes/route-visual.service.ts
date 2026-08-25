import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import {
  RouteVisualAnnotationSource,
  RouteVisualAnnotationStatus,
  type Prisma,
} from '@prisma/client';
import type { CurrentSession } from '../auth/session.service';
import { AuditService } from '../common/audit.service';
import { PrismaService } from '../database/prisma.service';
import { lockHoldOrganization } from '../holds/hold-transaction-lock';
import { AccessControlService, Capability } from '../security/access-control.service';
import type { SaveVisualAnnotationInput } from './route-operations.dto';

const versionInclude = {
  wallSegments: {
    orderBy: { ordinal: 'asc' as const },
    include: {
      wallSegment: {
        select: {
          id: true,
          code: true,
          name: true,
          area: { select: { code: true, name: true, floorLabel: true } },
        },
      },
    },
  },
  visualAnnotations: {
    orderBy: { revision: 'desc' as const },
    include: {
      points: {
        orderBy: { ordinal: 'asc' as const },
        include: { wallSegment: { select: { code: true, name: true } } },
      },
    },
  },
} satisfies Prisma.RouteVersionInclude;

type RouteVisualRecord = Prisma.RouteGetPayload<{
  include: { versions: { include: typeof versionInclude } };
}>;

@Injectable()
export class RouteVisualService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly access: AccessControlService,
  ) {}

  async get(session: CurrentSession, routeId: string) {
    this.access.assert(session, Capability.ASSET_READ);
    return mapWorkspace(await this.findRoute(this.prisma, session.organization.id, routeId));
  }

  async saveDraft(session: CurrentSession, routeId: string, input: SaveVisualAnnotationInput) {
    this.access.assert(session, Capability.ASSET_DRAFT_WRITE);
    await this.prisma.$transaction(async (transaction) => {
      await lockHoldOrganization(transaction, session.organization.id);
      const route = await this.findRoute(transaction, session.organization.id, routeId);
      const version = route.versions[0];
      if (!version) throw new BadRequestException('线路没有可标注的版本');
      assertPointsBelongToVersion(version, input);

      const draft = version.visualAnnotations.find(
        (annotation) => annotation.status === RouteVisualAnnotationStatus.DRAFT,
      );
      const revision = draft
        ? draft.revision
        : Math.max(0, ...version.visualAnnotations.map((annotation) => annotation.revision)) + 1;
      const annotation = draft
        ? await transaction.routeVisualAnnotation.update({
            where: { id: draft.id },
            data: { source: RouteVisualAnnotationSource.MANUAL },
          })
        : await transaction.routeVisualAnnotation.create({
            data: {
              organizationId: session.organization.id,
              routeVersionId: version.id,
              revision,
              createdByAccountId: session.account.id,
            },
          });
      await transaction.routeVisualPoint.deleteMany({ where: { annotationId: annotation.id } });
      await transaction.routeVisualPoint.createMany({
        data: input.points.map((point, ordinal) => ({
          organizationId: session.organization.id,
          annotationId: annotation.id,
          wallSegmentId: point.wallSegmentId,
          ordinal,
          role: point.role,
          uNormalized: point.uNormalized,
          vNormalized: point.vNormalized,
        })),
      });
      await this.audit.record(
        {
          organizationId: session.organization.id,
          actorAccountId: session.account.id,
          type: 'route_visual.saved',
          outcome: 'SUCCESS',
          metadata: { routeId, routeVersionId: version.id, annotationId: annotation.id, revision },
        },
        transaction,
      );
    });
    return this.get(session, routeId);
  }

  async confirm(session: CurrentSession, routeId: string) {
    this.access.assert(session, Capability.ASSET_PUBLISH);
    await this.prisma.$transaction(async (transaction) => {
      await lockHoldOrganization(transaction, session.organization.id);
      const route = await this.findRoute(transaction, session.organization.id, routeId);
      const version = route.versions[0];
      const draft = version?.visualAnnotations.find(
        (annotation) => annotation.status === RouteVisualAnnotationStatus.DRAFT,
      );
      if (!version || !draft || draft.points.length < 2) {
        throw new BadRequestException('请先保存包含起点和终点的视觉标注草稿');
      }
      await transaction.routeVisualAnnotation.updateMany({
        where: {
          routeVersionId: version.id,
          status: RouteVisualAnnotationStatus.CONFIRMED,
        },
        data: { status: RouteVisualAnnotationStatus.RETIRED, activeRouteVersionKey: null },
      });
      await transaction.routeVisualAnnotation.update({
        where: { id: draft.id },
        data: {
          status: RouteVisualAnnotationStatus.CONFIRMED,
          activeRouteVersionKey: version.id,
          confirmedByAccountId: session.account.id,
          confirmedAt: new Date(),
        },
      });
      await this.audit.record(
        {
          organizationId: session.organization.id,
          actorAccountId: session.account.id,
          type: 'route_visual.confirmed',
          outcome: 'SUCCESS',
          metadata: {
            routeId,
            routeVersionId: version.id,
            annotationId: draft.id,
            revision: draft.revision,
          },
        },
        transaction,
      );
    });
    return this.get(session, routeId);
  }

  private async findRoute(
    database: PrismaService | Prisma.TransactionClient,
    organizationId: string,
    routeId: string,
  ): Promise<RouteVisualRecord> {
    const route = await database.route.findFirst({
      where: { id: routeId, organizationId },
      include: {
        versions: {
          orderBy: { versionNumber: 'desc' },
          take: 1,
          include: versionInclude,
        },
      },
    });
    if (!route) throw new NotFoundException('线路不存在');
    return route;
  }
}

function assertPointsBelongToVersion(
  version: RouteVisualRecord['versions'][number],
  input: SaveVisualAnnotationInput,
) {
  const allowed = new Set(version.wallSegments.map((item) => item.wallSegmentId));
  if (input.points.some((point) => !allowed.has(point.wallSegmentId))) {
    throw new BadRequestException('视觉标注只能落在该线路关联的墙段上');
  }
}

function mapWorkspace(route: RouteVisualRecord) {
  const version = route.versions[0];
  if (!version) throw new NotFoundException('线路版本不存在');
  const draft = version.visualAnnotations.find(
    (annotation) => annotation.status === RouteVisualAnnotationStatus.DRAFT,
  );
  const confirmed = version.visualAnnotations.find(
    (annotation) => annotation.status === RouteVisualAnnotationStatus.CONFIRMED,
  );
  return {
    route: {
      id: route.id,
      code: route.code,
      name: route.name,
      status: route.status,
      color: version.color ?? route.color,
      grade: version.grade ?? route.grade,
    },
    version: { id: version.id, number: version.versionNumber, status: version.status },
    wallSegments: version.wallSegments.map(({ wallSegment }) => ({
      id: wallSegment.id,
      code: wallSegment.code,
      name: wallSegment.name,
      area: wallSegment.area,
    })),
    draft: draft ? mapAnnotation(draft) : null,
    confirmed: confirmed ? mapAnnotation(confirmed) : null,
  };
}

function mapAnnotation(
  annotation: RouteVisualRecord['versions'][number]['visualAnnotations'][number],
) {
  return {
    id: annotation.id,
    revision: annotation.revision,
    status: annotation.status,
    source: annotation.source,
    confirmedAt: annotation.confirmedAt?.toISOString() ?? null,
    updatedAt: annotation.updatedAt.toISOString(),
    points: annotation.points.map((point) => ({
      id: point.id,
      wallSegmentId: point.wallSegmentId,
      wallSegmentCode: point.wallSegment.code,
      ordinal: point.ordinal,
      role: point.role,
      uNormalized: point.uNormalized,
      vNormalized: point.vNormalized,
    })),
  };
}
