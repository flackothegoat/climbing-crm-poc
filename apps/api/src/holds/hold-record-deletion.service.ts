import { ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import {
  HoldAssetStatus,
  HoldScanStatus,
  HoldStatus,
  HoldInstallationStatus,
  HoldObservationMatchStatus,
  InventoryBucket,
  InventoryMovementType,
  Prisma,
  RouteVersionStatus,
} from '@prisma/client';
import type { CurrentSession } from '../auth/session.service';
import { PrismaService } from '../database/prisma.service';
import { AccessControlService, Capability } from '../security/access-control.service';
import type { PermanentlyDeleteSpecificationInput } from './hold.dto';
import { lockHoldOrganization } from './hold-transaction-lock';

const bucketFields = [
  [InventoryBucket.WAREHOUSE, 'warehouseQuantity'],
  [InventoryBucket.INSTALLED, 'installedQuantity'],
  [InventoryBucket.RESERVED, 'reservedQuantity'],
  [InventoryBucket.MAINTENANCE, 'maintenanceQuantity'],
] as const;

const deletionRecordInclude = {
  inventory: true,
  assets: {
    select: {
      id: true,
      kind: true,
      status: true,
      originalFileName: true,
      sizeBytes: true,
      checksumSha256: true,
    },
  },
  holdModel: { include: { category: { select: { id: true, name: true } } } },
  _count: {
    select: {
      routeHoldPlacements: {
        where: { routeVersion: { status: { not: RouteVersionStatus.RETIRED } } },
      },
      installations: { where: { status: HoldInstallationStatus.INSTALLED } },
      observedWallHolds: {
        where: { matchStatus: HoldObservationMatchStatus.CONFIRMED },
      },
    },
  },
} satisfies Prisma.HoldVariantInclude;

@Injectable()
export class HoldRecordDeletionService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly access: AccessControlService,
  ) {}

  async permanentlyDelete(
    session: CurrentSession,
    specificationId: string,
    input: PermanentlyDeleteSpecificationInput,
  ): Promise<void> {
    this.access.assert(session, Capability.HOLD_ARCHIVE);
    await this.prisma.$transaction(async (transaction) => {
      await lockHoldOrganization(transaction, session.organization.id);
      const record = await this.findRecord(session.organization.id, specificationId, transaction);
      assertRecordIsUnused(record);
      const inventory = requireInventory(record);
      if (inventory.version !== input.expectedVersion) {
        throw new ConflictException('库存刚刚发生变化，请刷新后重新确认删除');
      }
      const deletedAt = new Date();
      const plan = buildDeletionPlan(record, inventory, session, input, deletedAt);
      await this.executeDeletion(transaction, plan);
    });
  }

  private async executeDeletion(transaction: Prisma.TransactionClient, plan: DeletionPlan) {
    const { input, inventory, movements, record, session } = plan;
    const updated = await transaction.holdInventoryBalance.updateMany({
      where: { id: inventory.id, version: input.expectedVersion },
      data: {
        warehouseQuantity: 0,
        installedQuantity: 0,
        reservedQuantity: 0,
        maintenanceQuantity: 0,
        version: { increment: 1 },
      },
    });
    if (updated.count !== 1) {
      throw new ConflictException('库存刚刚发生变化，请刷新后重新确认删除');
    }
    if (movements.length) {
      await transaction.holdInventoryMovement.createMany({ data: movements });
    }
    await this.disableAssociatedContent(transaction, record.id);
    await transaction.holdVariant.update({
      where: { id: record.id },
      data: {
        status: HoldStatus.ARCHIVED,
        activeColorKey: null,
        deletedAt: plan.deletedAt,
        deletedByAccountId: session.account.id,
        deletionReason: input.reason,
        deletionSnapshot: plan.snapshot,
      },
    });
    await transaction.auditEvent.create({
      data: {
        organizationId: session.organization.id,
        actorAccountId: session.account.id,
        type: 'hold.record.permanently_deleted',
        outcome: 'SUCCESS',
        metadata: {
          categoryId: record.holdModel.categoryId,
          specificationId: record.id,
          clearedQuantity: totalInventory(inventory),
          movementCount: movements.length,
        },
      },
    });
  }

  private async disableAssociatedContent(
    transaction: Prisma.TransactionClient,
    specificationId: string,
  ): Promise<void> {
    await transaction.holdScan.updateMany({
      where: { specificationId, status: HoldScanStatus.DRAFT },
      data: { status: HoldScanStatus.CANCELLED },
    });
    await transaction.holdAsset.updateMany({
      where: { OR: [{ specificationId }, { scan: { specificationId } }] },
      data: { status: HoldAssetStatus.DELETED },
    });
  }

  private async findRecord(
    organizationId: string,
    specificationId: string,
    client: DeletionClient = this.prisma,
  ) {
    const record = await client.holdVariant.findFirst({
      where: { id: specificationId, deletedAt: null, holdModel: { organizationId } },
      include: deletionRecordInclude,
    });
    if (!record) throw new NotFoundException('岩点档案不存在或已经删除');
    return record;
  }
}

type DeletionRecord = Prisma.HoldVariantGetPayload<{
  include: typeof deletionRecordInclude;
}>;

type DeletionClient = Pick<PrismaService, 'holdVariant'> | Prisma.TransactionClient;

interface DeletionPlan {
  record: DeletionRecord;
  inventory: NonNullable<DeletionRecord['inventory']>;
  session: CurrentSession;
  input: PermanentlyDeleteSpecificationInput;
  deletedAt: Date;
  movements: Prisma.HoldInventoryMovementCreateManyInput[];
  snapshot: Prisma.InputJsonValue;
}

function buildDeletionPlan(
  record: DeletionRecord,
  inventory: NonNullable<DeletionRecord['inventory']>,
  session: CurrentSession,
  input: PermanentlyDeleteSpecificationInput,
  deletedAt: Date,
): DeletionPlan {
  return {
    record,
    inventory,
    session,
    input,
    deletedAt,
    movements: buildDeletionMovements(record, session, input.reason, deletedAt),
    snapshot: buildDeletionSnapshot(record, input.reason, deletedAt),
  };
}

function requireInventory(record: DeletionRecord): NonNullable<DeletionRecord['inventory']> {
  if (!record.inventory) throw new NotFoundException('岩点库存不存在');
  return record.inventory;
}

function assertRecordIsUnused(record: DeletionRecord): void {
  if (record._count.installations > 0) {
    throw new ConflictException('岩点仍有有效安装记录，请先完成拆除和库存回库');
  }
  if (record._count.routeHoldPlacements > 0) {
    throw new ConflictException('岩点仍被草稿或已发布线路引用，只能停用，不能永久删除');
  }
  if (record._count.observedWallHolds > 0) {
    throw new ConflictException('岩点已有已确认的墙面识别记录，只能停用，不能永久删除');
  }
}

function buildDeletionMovements(
  record: DeletionRecord,
  session: CurrentSession,
  reason: string,
  occurredAt: Date,
): Prisma.HoldInventoryMovementCreateManyInput[] {
  const inventory = record.inventory;
  if (!inventory) return [];
  return bucketFields.flatMap(([bucket, field]) => {
    const quantity = inventory[field];
    if (quantity === 0) return [];
    return [
      {
        organizationId: session.organization.id,
        variantId: record.id,
        type: InventoryMovementType.RECORD_DELETION,
        bucket,
        quantityDelta: -quantity,
        beforeQuantity: quantity,
        afterQuantity: 0,
        note: reason,
        referenceType: 'HOLD_RECORD_DELETION',
        referenceId: record.id,
        actorAccountId: session.account.id,
        occurredAt,
      },
    ];
  });
}

function buildDeletionSnapshot(
  record: DeletionRecord,
  reason: string,
  deletedAt: Date,
): Prisma.InputJsonValue {
  return {
    deletedAt: deletedAt.toISOString(),
    reason,
    category: { id: record.holdModel.category.id, name: record.holdModel.category.name },
    product: {
      id: record.holdModel.id,
      code: record.holdModel.code,
      name: record.holdModel.name,
      brand: record.holdModel.brand,
      gripType: record.holdModel.gripType,
      style: record.holdModel.style,
      sizeClass: record.holdModel.sizeClass,
      mountingType: record.holdModel.mountingType,
      widthMm: record.holdModel.widthMm,
      heightMm: record.holdModel.heightMm,
      depthMm: record.holdModel.depthMm,
      description: record.holdModel.description,
      identitySource: record.holdModel.identitySource,
      scanFingerprint: record.holdModel.scanFingerprint,
    },
    specification: {
      id: record.id,
      colorName: record.colorName,
      colorHex: record.colorHex,
      colorKey: record.colorKey,
      sku: record.sku,
      status: record.status,
    },
    inventory: record.inventory ? inventorySnapshot(record.inventory) : null,
    assets: record.assets.map((asset) => ({ ...asset, sizeBytes: Number(asset.sizeBytes) })),
  };
}

function inventorySnapshot(inventory: NonNullable<DeletionRecord['inventory']>) {
  return {
    warehouseQuantity: inventory.warehouseQuantity,
    installedQuantity: inventory.installedQuantity,
    reservedQuantity: inventory.reservedQuantity,
    maintenanceQuantity: inventory.maintenanceQuantity,
    verificationStatus: inventory.verificationStatus,
    version: inventory.version,
  };
}

function totalInventory(inventory: NonNullable<DeletionRecord['inventory']>): number {
  return bucketFields.reduce((sum, [, field]) => sum + inventory[field], 0);
}
