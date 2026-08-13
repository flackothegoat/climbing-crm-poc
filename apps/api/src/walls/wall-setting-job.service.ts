import { ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import {
  HoldInstallationSource,
  HoldInstallationStatus,
  InventoryBucket,
  RouteStatus,
  RouteVersionStatus,
  WallGeometryVersionStatus,
  WallSettingJobStatus,
  WallSettingReservationStatus,
  type Prisma,
} from '@prisma/client';
import { randomUUID } from 'node:crypto';
import type { CurrentSession } from '../auth/session.service';
import { AuditService } from '../common/audit.service';
import { PrismaService } from '../database/prisma.service';
import { isPrismaError } from '../database/prisma-errors';
import { HoldInventoryService } from '../holds/hold-inventory.service';
import { lockHoldOrganization } from '../holds/hold-transaction-lock';
import { AccessControlService, Capability } from '../security/access-control.service';
import type { CreateWallSettingJobInput, WallSettingJobActionInput } from './wall-setting-job.dto';

const jobInclude = {
  segments: true,
  reservations: true,
  routeVersions: {
    include: {
      route: true,
      placements: { include: { anchors: { orderBy: { ordinal: 'asc' as const } } } },
    },
  },
} satisfies Prisma.WallSettingJobInclude;

type JobWithPlan = Prisma.WallSettingJobGetPayload<{ include: typeof jobInclude }>;

@Injectable()
export class WallSettingJobService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly inventory: HoldInventoryService,
    private readonly audit: AuditService,
    private readonly access: AccessControlService,
  ) {}

  async createOrGet(session: CurrentSession, input: CreateWallSettingJobInput) {
    this.access.assert(session, Capability.ASSET_DRAFT_WRITE);
    const activeKey = jobSegmentActiveKey(session.organization.id, input.wallCode);
    try {
      return await this.prisma.$transaction(async (transaction) => {
        await lockHoldOrganization(transaction, session.organization.id);
        const existing = await transaction.wallSettingJobSegment.findUnique({
          where: { activeKey },
          include: { settingJob: { include: jobInclude } },
        });
        if (existing) return mapJob(existing.settingJob);
        const wall = await transaction.wallSegment.findFirst({
          where: { organizationId: session.organization.id, code: input.wallCode },
        });
        if (!wall) throw new NotFoundException('墙面不存在');
        const geometry = await transaction.wallGeometryVersion.findFirst({
          where: {
            organizationId: session.organization.id,
            wallSegmentId: wall.id,
            status: WallGeometryVersionStatus.PUBLISHED,
          },
          orderBy: { versionNumber: 'desc' },
        });
        if (!geometry) throw new ConflictException('墙面缺少可用几何版本');
        const job = await transaction.wallSettingJob.create({
          data: {
            organizationId: session.organization.id,
            code: `SETTING-${input.wallCode}-${randomUUID().slice(0, 8)}`,
            name: `${input.wallCode} 定线任务`,
            status: WallSettingJobStatus.DRAFT,
            startedAt: new Date(),
            createdByAccountId: session.account.id,
            segments: {
              create: {
                wallSegmentId: wall.id,
                geometryVersionId: geometry.id,
                ordinal: 0,
                activeKey,
              },
            },
          },
          include: jobInclude,
        });
        await this.audit.record(
          {
            organizationId: session.organization.id,
            actorAccountId: session.account.id,
            type: 'wall_setting_job.created',
            outcome: 'SUCCESS',
            metadata: { settingJobId: job.id, wallSegmentId: wall.id },
          },
          transaction,
        );
        return mapJob(job);
      });
    } catch (error) {
      if (!isPrismaError(error, 'P2002')) throw error;
      const existing = await this.prisma.wallSettingJobSegment.findUnique({
        where: { activeKey },
        include: { settingJob: { include: jobInclude } },
      });
      if (existing) return mapJob(existing.settingJob);
      throw new ConflictException('定线任务刚刚发生变化，请重试');
    }
  }

  async get(session: CurrentSession, jobId: string) {
    this.access.assert(session, Capability.ASSET_READ);
    return mapJob(await findJob(this.prisma, session.organization.id, jobId));
  }

  async lock(session: CurrentSession, jobId: string, input: WallSettingJobActionInput) {
    this.access.assert(session, Capability.ASSET_PUBLISH);
    return this.prisma.$transaction(async (transaction) => {
      await lockHoldOrganization(transaction, session.organization.id);
      const job = await findJob(transaction, session.organization.id, jobId);
      if (job.lockRequestKey === input.requestKey) return mapJob(job);
      if (job.status !== WallSettingJobStatus.DRAFT) {
        throw new ConflictException('只有草稿定线任务可以锁定库存');
      }
      const requirements = placementRequirements(job);
      if (!requirements.size) throw new ConflictException('定线方案至少需要一个真实岩点');
      for (const [variantId, quantity] of requirements) {
        await this.inventory.transferInTransaction(transaction, session, {
          variantId,
          from: InventoryBucket.WAREHOUSE,
          to: InventoryBucket.RESERVED,
          quantity,
          requestKey: `${input.requestKey}:reserve:${variantId}`,
          referenceType: 'ROUTE_ASSIGNMENT',
          referenceId: job.id,
          note: `${job.name}锁定方案`,
        });
        await transaction.wallSettingJobHoldReservation.create({
          data: {
            organizationId: session.organization.id,
            settingJobId: job.id,
            holdVariantId: variantId,
            quantity,
          },
        });
      }
      await transaction.route.updateMany({
        where: {
          id: {
            in: job.routeVersions
              .filter((version) => version.status === RouteVersionStatus.DRAFT)
              .map((version) => version.routeId),
          },
        },
        data: { status: RouteStatus.READY_FOR_INSTALL },
      });
      const updated = await transaction.wallSettingJob.update({
        where: { id: job.id },
        data: { status: WallSettingJobStatus.READY, lockRequestKey: input.requestKey },
        include: jobInclude,
      });
      await recordJobAudit(transaction, this.audit, session, updated, 'locked');
      return mapJob(updated);
    });
  }

  async cancel(session: CurrentSession, jobId: string, input: WallSettingJobActionInput) {
    this.access.assert(session, Capability.ASSET_PUBLISH);
    return this.prisma.$transaction(async (transaction) => {
      await lockHoldOrganization(transaction, session.organization.id);
      const job = await findJob(transaction, session.organization.id, jobId);
      if (job.cancelRequestKey === input.requestKey) return mapJob(job);
      if (job.status !== WallSettingJobStatus.DRAFT && job.status !== WallSettingJobStatus.READY) {
        throw new ConflictException('当前定线任务不能取消');
      }
      for (const reservation of job.reservations.filter(
        (item) => item.status === WallSettingReservationStatus.ACTIVE,
      )) {
        await this.inventory.transferInTransaction(transaction, session, {
          variantId: reservation.holdVariantId,
          from: InventoryBucket.RESERVED,
          to: InventoryBucket.WAREHOUSE,
          quantity: reservation.quantity,
          requestKey: `${input.requestKey}:release:${reservation.holdVariantId}`,
          referenceType: 'ROUTE_ASSIGNMENT',
          referenceId: job.id,
          note: `${job.name}取消释放预留`,
        });
        await transaction.wallSettingJobHoldReservation.update({
          where: { id: reservation.id },
          data: { status: WallSettingReservationStatus.RELEASED, releasedAt: new Date() },
        });
      }
      await retireJobRoutes(transaction, job);
      await transaction.wallSettingJobSegment.updateMany({
        where: { settingJobId: job.id },
        data: { activeKey: null },
      });
      const updated = await transaction.wallSettingJob.update({
        where: { id: job.id },
        data: { status: WallSettingJobStatus.CANCELLED, cancelRequestKey: input.requestKey },
        include: jobInclude,
      });
      await recordJobAudit(transaction, this.audit, session, updated, 'cancelled');
      return mapJob(updated);
    });
  }

  async complete(session: CurrentSession, jobId: string, input: WallSettingJobActionInput) {
    this.access.assert(session, Capability.ASSET_PUBLISH);
    return this.prisma.$transaction(async (transaction) => {
      await lockHoldOrganization(transaction, session.organization.id);
      const job = await findJob(transaction, session.organization.id, jobId);
      if (job.completeRequestKey === input.requestKey) return mapJob(job);
      if (job.status !== WallSettingJobStatus.READY) {
        throw new ConflictException('只有已锁定方案可以确认现场安装完成');
      }
      assertReservationsMatchPlan(job);
      const installedAt = input.installedAt ? new Date(input.installedAt) : new Date();
      const activeVersions = job.routeVersions.filter(
        (version) => version.status === RouteVersionStatus.DRAFT,
      );
      for (const version of activeVersions) {
        for (const placement of version.placements) {
          if (!placement.holdVariantId) throw new ConflictException('定线方案包含演示岩点');
          await transaction.holdInstallation.create({
            data: {
              organizationId: session.organization.id,
              installRequestKey: `${input.requestKey}:installation:${placement.id}`,
              holdVariantId: placement.holdVariantId,
              routeVersionId: version.id,
              routeHoldPlacementId: placement.id,
              settingJobId: job.id,
              status: HoldInstallationStatus.INSTALLED,
              source: HoldInstallationSource.SETTING_JOB,
              installedAt,
              installedByAccountId: session.account.id,
              anchors: {
                create: placement.anchors.map((anchor, ordinal) => ({
                  organizationId: session.organization.id,
                  wallHoleId: anchor.wallHoleId,
                  role: anchor.role,
                  ordinal,
                })),
              },
            },
          });
        }
      }
      for (const reservation of job.reservations.filter(
        (item) => item.status === WallSettingReservationStatus.ACTIVE,
      )) {
        await this.inventory.transferInTransaction(transaction, session, {
          variantId: reservation.holdVariantId,
          from: InventoryBucket.RESERVED,
          to: InventoryBucket.INSTALLED,
          quantity: reservation.quantity,
          requestKey: `${input.requestKey}:install:${reservation.holdVariantId}`,
          referenceType: 'ROUTE_ASSIGNMENT',
          referenceId: job.id,
          note: `${job.name}现场安装完成`,
        });
        await transaction.wallSettingJobHoldReservation.update({
          where: { id: reservation.id },
          data: { status: WallSettingReservationStatus.CONSUMED, consumedAt: installedAt },
        });
      }
      const routeIds = [...new Set(activeVersions.map((version) => version.routeId))];
      await transaction.routeVersion.updateMany({
        where: {
          routeId: { in: routeIds },
          status: RouteVersionStatus.PUBLISHED,
          settingJobId: { not: job.id },
        },
        data: { status: RouteVersionStatus.RETIRED },
      });
      await transaction.routeVersion.updateMany({
        where: { settingJobId: job.id, status: RouteVersionStatus.DRAFT },
        data: { status: RouteVersionStatus.PUBLISHED },
      });
      await transaction.route.updateMany({
        where: { id: { in: routeIds } },
        data: { status: RouteStatus.PUBLISHED },
      });
      await transaction.wallSettingJobSegment.updateMany({
        where: { settingJobId: job.id },
        data: { activeKey: null },
      });
      const updated = await transaction.wallSettingJob.update({
        where: { id: job.id },
        data: {
          status: WallSettingJobStatus.COMPLETED,
          completeRequestKey: input.requestKey,
          completedAt: installedAt,
        },
        include: jobInclude,
      });
      await recordJobAudit(transaction, this.audit, session, updated, 'completed');
      return mapJob(updated);
    });
  }
}

async function findJob(
  client: PrismaService | Prisma.TransactionClient,
  organizationId: string,
  jobId: string,
): Promise<JobWithPlan> {
  const job = await client.wallSettingJob.findFirst({
    where: { id: jobId, organizationId },
    include: jobInclude,
  });
  if (!job) throw new NotFoundException('定线任务不存在');
  return job;
}

function placementRequirements(job: JobWithPlan): Map<string, number> {
  const requirements = new Map<string, number>();
  for (const version of job.routeVersions) {
    if (version.status !== RouteVersionStatus.DRAFT) continue;
    for (const placement of version.placements) {
      if (!placement.holdVariantId) throw new ConflictException('演示岩点不能锁定正式库存');
      requirements.set(
        placement.holdVariantId,
        (requirements.get(placement.holdVariantId) ?? 0) + 1,
      );
    }
  }
  return requirements;
}

function assertReservationsMatchPlan(job: JobWithPlan): void {
  const requirements = placementRequirements(job);
  const active = job.reservations.filter(
    (reservation) => reservation.status === WallSettingReservationStatus.ACTIVE,
  );
  if (
    active.length !== requirements.size ||
    active.some(
      (reservation) => requirements.get(reservation.holdVariantId) !== reservation.quantity,
    )
  ) {
    throw new ConflictException('预留库存与当前定线方案不一致');
  }
}

async function retireJobRoutes(transaction: Prisma.TransactionClient, job: JobWithPlan) {
  const routeIds = [...new Set(job.routeVersions.map((version) => version.routeId))];
  await transaction.routeVersion.updateMany({
    where: { settingJobId: job.id, status: RouteVersionStatus.DRAFT },
    data: { status: RouteVersionStatus.RETIRED },
  });
  for (const routeId of routeIds) {
    const activeCount = await transaction.routeVersion.count({
      where: {
        routeId,
        status: { in: [RouteVersionStatus.DRAFT, RouteVersionStatus.PUBLISHED] },
      },
    });
    if (!activeCount) {
      await transaction.route.update({
        where: { id: routeId },
        data: { status: RouteStatus.INACTIVE },
      });
    }
  }
}

function mapJob(job: JobWithPlan) {
  return {
    id: job.id,
    code: job.code,
    name: job.name,
    status: job.status,
    startedAt: job.startedAt?.toISOString() ?? null,
    completedAt: job.completedAt?.toISOString() ?? null,
    routeCount: job.routeVersions.filter((version) => version.status !== RouteVersionStatus.RETIRED)
      .length,
    placementCount: job.routeVersions
      .filter((version) => version.status !== RouteVersionStatus.RETIRED)
      .reduce((total, version) => total + version.placements.length, 0),
    reservations: job.reservations.map((reservation) => ({
      holdVariantId: reservation.holdVariantId,
      quantity: reservation.quantity,
      status: reservation.status,
    })),
  };
}

function jobSegmentActiveKey(organizationId: string, wallCode: string): string {
  return `${organizationId}:${wallCode}`;
}

function recordJobAudit(
  transaction: Prisma.TransactionClient,
  audit: AuditService,
  session: CurrentSession,
  job: JobWithPlan,
  action: string,
) {
  return audit.record(
    {
      organizationId: session.organization.id,
      actorAccountId: session.account.id,
      type: `wall_setting_job.${action}`,
      outcome: 'SUCCESS',
      metadata: {
        settingJobId: job.id,
        routeCount: job.routeVersions.length,
        placementCount: job.routeVersions.reduce(
          (total, version) => total + version.placements.length,
          0,
        ),
      },
    },
    transaction,
  );
}
