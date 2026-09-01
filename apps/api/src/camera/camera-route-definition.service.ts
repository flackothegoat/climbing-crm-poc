import {
  BadRequestException,
  Injectable,
  NotFoundException,
  ServiceUnavailableException,
} from '@nestjs/common';
import { RouteStatus, RouteVersionStatus, WallStatus, type Prisma } from '@prisma/client';
import type { CurrentSession } from '../auth/session.service';
import { AuditService } from '../common/audit.service';
import { AppConfigService } from '../config/app-config.service';
import { PrismaService } from '../database/prisma.service';
import { AccessControlService, Capability } from '../security/access-control.service';
import type {
  CameraRouteHoldInput,
  SaveCameraRouteDefinitionInput,
} from './camera-route-definition.dto';

export const PRIMARY_CAMERA_KEY = 'gym-wall-primary';

const definitionInclude = {
  route: { select: { id: true, code: true, name: true, color: true } },
  routeVersion: { select: { id: true, versionNumber: true, status: true } },
  wallSegment: { select: { id: true, code: true, name: true } },
} satisfies Prisma.CameraRouteDefinitionInclude;

type DefinitionRecord = Prisma.CameraRouteDefinitionGetPayload<{
  include: typeof definitionInclude;
}>;

@Injectable()
export class CameraRouteDefinitionService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly access: AccessControlService,
    private readonly config: AppConfigService,
  ) {}

  async workspace(session: CurrentSession) {
    this.access.assert(session, Capability.ASSET_READ);
    const [routes, wallSegments, definitions] = await Promise.all([
      this.prisma.route.findMany({
        where: { organizationId: session.organization.id, status: { not: RouteStatus.REMOVED } },
        orderBy: [{ updatedAt: 'desc' }, { code: 'asc' }],
        select: {
          id: true,
          code: true,
          name: true,
          status: true,
          color: true,
          grade: true,
          versions: {
            orderBy: { versionNumber: 'desc' },
            take: 1,
            select: {
              id: true,
              versionNumber: true,
              status: true,
              wallSegments: {
                orderBy: { ordinal: 'asc' },
                select: { wallSegmentId: true },
              },
            },
          },
        },
      }),
      this.prisma.wallSegment.findMany({
        where: { organizationId: session.organization.id, status: WallStatus.ACTIVE },
        orderBy: [{ code: 'asc' }],
        select: { id: true, code: true, name: true },
      }),
      this.prisma.cameraRouteDefinition.findMany({
        where: {
          organizationId: session.organization.id,
          cameraKey: PRIMARY_CAMERA_KEY,
          route: { status: { not: RouteStatus.REMOVED } },
          routeVersion: { status: { not: RouteVersionStatus.RETIRED } },
        },
        orderBy: { updatedAt: 'desc' },
        include: definitionInclude,
      }),
    ]);
    return {
      cameraKey: PRIMARY_CAMERA_KEY,
      routes: routes.flatMap((route) => {
        const version = route.versions[0];
        return version
          ? [
              {
                id: route.id,
                code: route.code,
                name: route.name,
                status: route.status,
                color: route.color,
                grade: route.grade,
                version: {
                  id: version.id,
                  number: version.versionNumber,
                  status: version.status,
                  wallSegmentIds: version.wallSegments.map((item) => item.wallSegmentId),
                },
              },
            ]
          : [];
      }),
      wallSegments,
      definitions: definitions.map(mapDefinition),
    };
  }

  async save(session: CurrentSession, input: SaveCameraRouteDefinitionInput) {
    this.access.assert(session, Capability.ASSET_DRAFT_WRITE);
    const saved = await this.prisma.$transaction(async (transaction) => {
      const version = await transaction.routeVersion.findFirst({
        where: {
          id: input.routeVersionId,
          routeId: input.routeId,
          organizationId: session.organization.id,
          status: { not: RouteVersionStatus.RETIRED },
          route: { status: { not: RouteStatus.REMOVED } },
        },
        select: {
          id: true,
          wallSegments: { select: { wallSegmentId: true } },
        },
      });
      if (!version) throw new NotFoundException('线路版本不存在');
      if (!version.wallSegments.some((item) => item.wallSegmentId === input.wallSegmentId)) {
        throw new BadRequestException('摄像头线路定义必须绑定该线路版本关联的墙段');
      }

      const existing = await transaction.cameraRouteDefinition.findUnique({
        where: {
          organizationId_cameraKey_routeVersionId: {
            organizationId: session.organization.id,
            cameraKey: PRIMARY_CAMERA_KEY,
            routeVersionId: input.routeVersionId,
          },
        },
        select: { id: true, revision: true },
      });
      const definition = existing
        ? await transaction.cameraRouteDefinition.update({
            where: { id: existing.id },
            data: definitionData(input, session.account.id, existing.revision + 1),
            include: definitionInclude,
          })
        : await transaction.cameraRouteDefinition.create({
            data: {
              organizationId: session.organization.id,
              cameraKey: PRIMARY_CAMERA_KEY,
              routeId: input.routeId,
              routeVersionId: input.routeVersionId,
              createdByAccountId: session.account.id,
              ...definitionData(input, session.account.id, 1),
            },
            include: definitionInclude,
          });
      await this.audit.record(
        {
          organizationId: session.organization.id,
          actorAccountId: session.account.id,
          type: 'camera.route_definition.saved',
          outcome: 'SUCCESS',
          metadata: {
            definitionId: definition.id,
            routeId: input.routeId,
            routeVersionId: input.routeVersionId,
            revision: definition.revision,
            holdCount: input.holds.length,
          },
        },
        transaction,
      );
      return definition;
    });
    return mapDefinition(saved);
  }

  async listForWorker() {
    const organizationId = this.config.values.CAMERA_WORKER_ORGANIZATION_ID;
    if (!organizationId) {
      throw new ServiceUnavailableException('摄像头 Worker 尚未绑定组织');
    }
    const definitions = await this.prisma.cameraRouteDefinition.findMany({
      where: {
        organizationId,
        cameraKey: PRIMARY_CAMERA_KEY,
        route: { status: RouteStatus.PUBLISHED },
        routeVersion: { status: RouteVersionStatus.PUBLISHED },
      },
      orderBy: { updatedAt: 'desc' },
      include: definitionInclude,
    });
    return {
      cameraKey: PRIMARY_CAMERA_KEY,
      definitions: definitions.map(mapDefinition),
    };
  }
}

function definitionData(
  input: SaveCameraRouteDefinitionInput,
  actorAccountId: string,
  revision: number,
) {
  return {
    wallSegmentId: input.wallSegmentId,
    revision,
    roiX1: input.roi.x1,
    roiY1: input.roi.y1,
    roiX2: input.roi.x2,
    roiY2: input.roi.y2,
    referenceWidth: input.referenceWidth,
    referenceHeight: input.referenceHeight,
    holds: input.holds as unknown as Prisma.InputJsonValue,
    startHoldIds: input.startHoldIds,
    finishHoldIds: input.finishHoldIds,
    updatedByAccountId: actorAccountId,
  };
}

function mapDefinition(definition: DefinitionRecord) {
  return {
    id: definition.id,
    cameraKey: definition.cameraKey,
    revision: definition.revision,
    route: definition.route,
    routeVersion: definition.routeVersion,
    wallSegment: definition.wallSegment,
    reference: { width: definition.referenceWidth, height: definition.referenceHeight },
    roi: {
      x1: definition.roiX1,
      y1: definition.roiY1,
      x2: definition.roiX2,
      y2: definition.roiY2,
    },
    holds: definition.holds as CameraRouteHoldInput[],
    startHoldIds: definition.startHoldIds,
    finishHoldIds: definition.finishHoldIds,
    updatedAt: definition.updatedAt.toISOString(),
  };
}
