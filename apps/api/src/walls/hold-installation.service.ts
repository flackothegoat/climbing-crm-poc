import { ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import {
  HoldInstallationStatus,
  HoldStatus,
  InventoryBucket,
  RouteVersionStatus,
  type PlacementAnchorRole,
  type Prisma,
} from '@prisma/client';
import type { CurrentSession } from '../auth/session.service';
import { AuditService } from '../common/audit.service';
import { PrismaService } from '../database/prisma.service';
import { HoldInventoryService } from '../holds/hold-inventory.service';
import { lockHoldOrganization } from '../holds/hold-transaction-lock';
import { AccessControlService, Capability } from '../security/access-control.service';
import type { InstallHoldInput, RemoveHoldInput } from './hold-installation.dto';

interface InstallationContext {
  holdVariantId: string;
  routeVersionId?: string;
  routeHoldPlacementId?: string;
  anchors: Array<{ wallHoleId: string; role: PlacementAnchorRole }>;
}

@Injectable()
export class HoldInstallationService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly inventory: HoldInventoryService,
    private readonly audit: AuditService,
    private readonly access: AccessControlService,
  ) {}

  async install(session: CurrentSession, input: InstallHoldInput) {
    this.access.assert(session, Capability.ASSET_DRAFT_WRITE);
    return this.prisma.$transaction(async (transaction) => {
      await lockHoldOrganization(transaction, session.organization.id);
      const replay = await transaction.holdInstallation.findUnique({
        where: {
          organizationId_installRequestKey: {
            organizationId: session.organization.id,
            installRequestKey: input.requestKey,
          },
        },
        include: { anchors: true },
      });
      if (replay) return mapInstallation(replay);
      const context = await resolveInstallationContext(transaction, session.organization.id, input);
      const installation = await transaction.holdInstallation.create({
        data: {
          organizationId: session.organization.id,
          installRequestKey: input.requestKey,
          holdVariantId: context.holdVariantId,
          routeVersionId: context.routeVersionId,
          routeHoldPlacementId: context.routeHoldPlacementId,
          settingJobId: input.settingJobId,
          status: HoldInstallationStatus.INSTALLED,
          source: input.source,
          installedAt: input.installedAt ? new Date(input.installedAt) : new Date(),
          installedByAccountId: session.account.id,
          note: input.note,
          anchors: {
            create: context.anchors.map((anchor, ordinal) => ({
              organizationId: session.organization.id,
              wallHoleId: anchor.wallHoleId,
              role: anchor.role,
              ordinal,
            })),
          },
        },
        include: { anchors: true },
      });
      await this.inventory.transferInTransaction(transaction, session, {
        variantId: context.holdVariantId,
        from: InventoryBucket.WAREHOUSE,
        to: InventoryBucket.INSTALLED,
        quantity: 1,
        requestKey: input.requestKey,
        referenceType: 'HOLD_INSTALLATION',
        referenceId: installation.id,
        note: input.note,
      });
      await this.audit.record(
        {
          organizationId: session.organization.id,
          actorAccountId: session.account.id,
          type: 'hold.installation.installed',
          outcome: 'SUCCESS',
          metadata: {
            installationId: installation.id,
            holdVariantId: context.holdVariantId,
            routeVersionId: context.routeVersionId,
          },
        },
        transaction,
      );
      return mapInstallation(installation);
    });
  }

  async remove(session: CurrentSession, installationId: string, input: RemoveHoldInput) {
    this.access.assert(session, Capability.ASSET_DRAFT_WRITE);
    return this.prisma.$transaction(async (transaction) => {
      await lockHoldOrganization(transaction, session.organization.id);
      const replay = await transaction.holdInstallation.findUnique({
        where: {
          organizationId_removeRequestKey: {
            organizationId: session.organization.id,
            removeRequestKey: input.requestKey,
          },
        },
        include: { anchors: true },
      });
      if (replay) {
        if (replay.id !== installationId) {
          throw new ConflictException('请求标识已用于其他拆除操作');
        }
        return mapInstallation(replay);
      }
      const installation = await transaction.holdInstallation.findFirst({
        where: {
          id: installationId,
          organizationId: session.organization.id,
          status: HoldInstallationStatus.INSTALLED,
        },
        include: { anchors: true },
      });
      if (!installation) throw new NotFoundException('可拆除的岩点安装记录不存在');
      const removedAt = input.removedAt ? new Date(input.removedAt) : new Date();
      if (removedAt < installation.installedAt)
        throw new ConflictException('拆除时间不能早于安装时间');
      await transaction.holdInstallationAnchor.updateMany({
        where: { installationId, releasedAt: null },
        data: { releasedAt: removedAt },
      });
      const removed = await transaction.holdInstallation.update({
        where: { id: installationId },
        data: {
          status: HoldInstallationStatus.REMOVED,
          removeRequestKey: input.requestKey,
          removedAt,
          removedByAccountId: session.account.id,
          note: input.note ?? installation.note,
        },
        include: { anchors: true },
      });
      await this.inventory.transferInTransaction(transaction, session, {
        variantId: installation.holdVariantId,
        from: InventoryBucket.INSTALLED,
        to: input.targetBucket,
        quantity: 1,
        requestKey: input.requestKey,
        referenceType: 'HOLD_INSTALLATION',
        referenceId: installation.id,
        note: input.note,
      });
      await this.audit.record(
        {
          organizationId: session.organization.id,
          actorAccountId: session.account.id,
          type: 'hold.installation.removed',
          outcome: 'SUCCESS',
          metadata: {
            installationId,
            holdVariantId: installation.holdVariantId,
            targetBucket: input.targetBucket,
          },
        },
        transaction,
      );
      return mapInstallation(removed);
    });
  }
}

async function resolveInstallationContext(
  transaction: Prisma.TransactionClient,
  organizationId: string,
  input: InstallHoldInput,
): Promise<InstallationContext> {
  if (input.routeHoldPlacementId) {
    const placement = await transaction.routeHoldPlacement.findFirst({
      where: {
        id: input.routeHoldPlacementId,
        organizationId,
        holdVariantId: { not: null },
        routeVersion: { status: { not: RouteVersionStatus.RETIRED } },
      },
      include: { anchors: { orderBy: { ordinal: 'asc' } } },
    });
    if (!placement?.holdVariantId) throw new NotFoundException('可安装的正式线路岩点位置不存在');
    return {
      holdVariantId: placement.holdVariantId,
      routeVersionId: placement.routeVersionId,
      routeHoldPlacementId: placement.id,
      anchors: placement.anchors.map((anchor) => ({
        wallHoleId: anchor.wallHoleId,
        role: anchor.role,
      })),
    };
  }
  const variant = await transaction.holdVariant.findFirst({
    where: {
      id: input.holdVariantId!,
      status: HoldStatus.ACTIVE,
      deletedAt: null,
      holdModel: { organizationId, status: HoldStatus.ACTIVE },
    },
    select: { id: true },
  });
  if (!variant) throw new NotFoundException('可安装的岩点档案不存在');
  const requested = input.anchors!;
  const holes = await transaction.wallHole.findMany({
    where: { id: { in: requested.map((anchor) => anchor.wallHoleId) }, organizationId },
    select: { id: true, geometryVersionId: true },
  });
  if (holes.length !== requested.length) throw new ConflictException('安装包含无效或跨岩馆孔位');
  if (new Set(holes.map((hole) => hole.geometryVersionId)).size !== 1) {
    throw new ConflictException('一个岩点的安装孔必须属于同一墙面几何版本');
  }
  return { holdVariantId: variant.id, anchors: requested };
}

function mapInstallation(installation: {
  id: string;
  holdVariantId: string;
  routeVersionId: string | null;
  routeHoldPlacementId: string | null;
  settingJobId: string | null;
  status: HoldInstallationStatus;
  source: string;
  installedAt: Date;
  removedAt: Date | null;
  note: string | null;
  anchors: Array<{
    wallHoleId: string;
    role: PlacementAnchorRole;
    ordinal: number;
    releasedAt: Date | null;
  }>;
}) {
  return {
    id: installation.id,
    holdVariantId: installation.holdVariantId,
    routeVersionId: installation.routeVersionId,
    routeHoldPlacementId: installation.routeHoldPlacementId,
    settingJobId: installation.settingJobId,
    status: installation.status,
    source: installation.source,
    installedAt: installation.installedAt.toISOString(),
    removedAt: installation.removedAt?.toISOString() ?? null,
    note: installation.note,
    anchors: installation.anchors.map((anchor) => ({
      wallHoleId: anchor.wallHoleId,
      role: anchor.role,
      ordinal: anchor.ordinal,
      releasedAt: anchor.releasedAt?.toISOString() ?? null,
    })),
  };
}
