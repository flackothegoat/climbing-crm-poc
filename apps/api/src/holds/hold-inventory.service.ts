import { ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { HoldStatus, InventoryBucket, InventoryMovementType, Prisma } from '@prisma/client';
import type { HoldInventoryBalance } from '@prisma/client';
import type { CurrentSession } from '../auth/session.service';
import { AuditService } from '../common/audit.service';
import { PrismaService } from '../database/prisma.service';
import { AccessControlService, Capability } from '../security/access-control.service';
import type { ReverseMovementInput, StockMovementInput } from './hold.dto';
import { inventoryValues } from './hold.mapper';
import { lockHoldOrganization } from './hold-transaction-lock';

type QuantityField =
  'warehouseQuantity' | 'installedQuantity' | 'reservedQuantity' | 'maintenanceQuantity';

interface MovementCommand {
  type: InventoryMovementType;
  bucket: InventoryBucket;
  quantityDelta: number;
  note?: string | null;
  reversalOfMovementId?: string;
  requestKey?: string;
  requestFingerprint?: string;
  referenceType?: string;
  referenceId?: string;
}

export interface HoldInventoryTransferInput {
  variantId: string;
  from: InventoryBucket;
  to: InventoryBucket;
  quantity: number;
  requestKey: string;
  referenceType: 'WALL_PLACEMENT' | 'ROUTE_ASSIGNMENT' | 'HOLD_INSTALLATION';
  referenceId: string;
  note?: string;
}

const quantityFieldByBucket: Record<InventoryBucket, QuantityField> = {
  [InventoryBucket.WAREHOUSE]: 'warehouseQuantity',
  [InventoryBucket.INSTALLED]: 'installedQuantity',
  [InventoryBucket.RESERVED]: 'reservedQuantity',
  [InventoryBucket.MAINTENANCE]: 'maintenanceQuantity',
};

@Injectable()
export class HoldInventoryService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly access: AccessControlService,
  ) {}

  async summary(session: CurrentSession) {
    this.access.assert(session, Capability.HOLD_READ);
    const variantFilter = activeVariantFilter(session.organization.id);
    const [categoryCount, specificationCount, totals, unverifiedCount] =
      await this.prisma.$transaction([
        this.prisma.holdCategory.count({
          where: { organizationId: session.organization.id, status: HoldStatus.ACTIVE },
        }),
        this.prisma.holdVariant.count({ where: variantFilter }),
        this.prisma.holdInventoryBalance.aggregate({
          where: { variant: variantFilter },
          _sum: quantitySums,
        }),
        this.prisma.holdInventoryBalance.count({
          where: { variant: variantFilter, verificationStatus: { not: 'VERIFIED' } },
        }),
      ]);
    return buildSummary(
      categoryCount,
      specificationCount,
      totals._sum ?? emptyQuantitySums,
      unverifiedCount,
    );
  }

  async recordMovement(session: CurrentSession, variantId: string, input: StockMovementInput) {
    this.assertMovementCapability(session, input.type);
    return this.prisma.$transaction(async (transaction) => {
      await lockHoldOrganization(transaction, session.organization.id);
      const fingerprint = movementFingerprint(variantId, input);
      const replay = await this.findReplay(
        transaction,
        session,
        variantId,
        input.requestKey,
        fingerprint,
      );
      if (replay) return replay;
      const variant = await findActiveVariant(transaction, session.organization.id, variantId);
      const command = movementCommand(variant.inventory, input, fingerprint);
      return this.applyMovement(transaction, session, variant, command);
    });
  }

  async reverseReceipt(session: CurrentSession, movementId: string, input: ReverseMovementInput) {
    this.access.assert(session, Capability.HOLD_ADJUST);
    return this.prisma.$transaction(async (transaction) => {
      await lockHoldOrganization(transaction, session.organization.id);
      const movement = await findMovementForReversal(
        transaction,
        session.organization.id,
        movementId,
      );
      assertReversibleReceipt(movement);
      if (!movement.variant.inventory) throw new NotFoundException('可用岩点库存不存在');
      const variant = {
        ...movement.variant,
        inventory: movement.variant.inventory,
        holdModel: { categoryId: movement.variant.holdModel.categoryId },
      };
      return this.applyMovement(
        transaction,
        session,
        variant,
        reversalCommand(movement, input.reason),
      );
    });
  }

  /** Wall and route modules must use this atomic boundary instead of two adjustments. */
  async transfer(session: CurrentSession, input: HoldInventoryTransferInput) {
    this.access.assert(session, Capability.HOLD_WRITE);
    assertTransferInput(input);
    return this.prisma.$transaction(async (transaction) => {
      await lockHoldOrganization(transaction, session.organization.id);
      return this.transferInTransaction(transaction, session, input);
    });
  }

  /** Compose installation state and inventory movements inside one caller-owned transaction. */
  async transferInTransaction(
    transaction: Prisma.TransactionClient,
    session: CurrentSession,
    input: HoldInventoryTransferInput,
  ) {
    this.access.assert(session, Capability.HOLD_WRITE);
    assertTransferInput(input);
    const fingerprint = transferFingerprint(input);
    const replay = await this.findReplay(
      transaction,
      session,
      input.variantId,
      input.requestKey,
      fingerprint,
    );
    if (replay) return replay;
    const variant = await findActiveVariant(transaction, session.organization.id, input.variantId);
    return applyTransfer(transaction, this.audit, session, variant, input, fingerprint);
  }

  private async findReplay(
    transaction: Prisma.TransactionClient,
    session: CurrentSession,
    variantId: string,
    requestKey: string,
    fingerprint: string,
  ) {
    const movement = await transaction.holdInventoryMovement.findUnique({
      where: {
        organizationId_requestKey: {
          organizationId: session.organization.id,
          requestKey,
        },
      },
    });
    if (!movement) return null;
    if (
      movement.organizationId !== session.organization.id ||
      movement.variantId !== variantId ||
      movement.requestFingerprint !== fingerprint
    ) {
      throw new ConflictException('请求标识已用于其他库存操作');
    }
    const balance = await transaction.holdInventoryBalance.findUniqueOrThrow({
      where: { variantId },
    });
    return inventoryValues(balance);
  }

  private async applyMovement(
    transaction: Prisma.TransactionClient,
    session: CurrentSession,
    variant: ActiveVariant,
    command: MovementCommand,
  ) {
    const field = quantityFieldByBucket[command.bucket];
    const beforeQuantity = variant.inventory[field];
    const afterQuantity = beforeQuantity + command.quantityDelta;
    if (afterQuantity < 0) throw new ConflictException('当前库存不足，无法撤销或调整');
    await updateBalance(transaction, variant.inventory, { [field]: afterQuantity });
    await transaction.holdInventoryMovement.create({
      data: movementData(session, variant.id, command, beforeQuantity, afterQuantity),
    });
    await recordMovementAudit(
      transaction,
      this.audit,
      session,
      variant.holdModel.categoryId,
      variant.id,
      command,
    );
    const updated = await transaction.holdInventoryBalance.findUniqueOrThrow({
      where: { id: variant.inventory.id },
    });
    return inventoryValues(updated);
  }

  private assertMovementCapability(session: CurrentSession, type: InventoryMovementType): void {
    const capability =
      type === InventoryMovementType.RECEIPT ? Capability.HOLD_RECEIVE : Capability.HOLD_ADJUST;
    this.access.assert(session, capability);
  }
}

const activeVariantInclude = { inventory: true, holdModel: { select: { categoryId: true } } };
type ActiveVariant = Prisma.HoldVariantGetPayload<{ include: typeof activeVariantInclude }> & {
  inventory: HoldInventoryBalance;
};

async function findActiveVariant(
  transaction: Prisma.TransactionClient,
  organizationId: string,
  variantId: string,
): Promise<ActiveVariant> {
  const variant = await transaction.holdVariant.findFirst({
    where: { id: variantId, ...activeVariantFilter(organizationId) },
    include: activeVariantInclude,
  });
  if (!variant?.inventory) throw new NotFoundException('可用岩点库存不存在');
  return { ...variant, inventory: variant.inventory };
}

function activeVariantFilter(organizationId: string) {
  return {
    status: HoldStatus.ACTIVE,
    deletedAt: null,
    holdModel: { organizationId, category: { status: HoldStatus.ACTIVE } },
  };
}

async function updateBalance(
  transaction: Prisma.TransactionClient,
  balance: HoldInventoryBalance,
  quantities: Partial<Record<QuantityField, number>>,
): Promise<void> {
  const updated = await transaction.holdInventoryBalance.updateMany({
    where: { id: balance.id, version: balance.version },
    data: { ...quantities, version: { increment: 1 } },
  });
  if (!updated.count) throw new ConflictException('库存已被其他操作更新，请刷新后重试');
}

type ReversibleMovement = Prisma.HoldInventoryMovementGetPayload<{
  include: {
    reversedBy: { select: { id: true } };
    variant: {
      include: {
        inventory: true;
        holdModel: { select: { categoryId: true; category: { select: { status: true } } } };
      };
    };
  };
}>;

async function findMovementForReversal(
  transaction: Prisma.TransactionClient,
  organizationId: string,
  movementId: string,
): Promise<ReversibleMovement> {
  const movement = await transaction.holdInventoryMovement.findFirst({
    where: { id: movementId, organizationId },
    include: {
      reversedBy: { select: { id: true } },
      variant: {
        include: {
          inventory: true,
          holdModel: { select: { categoryId: true, category: { select: { status: true } } } },
        },
      },
    },
  });
  if (!movement) throw new NotFoundException('入库流水不存在');
  return movement;
}

function assertReversibleReceipt(movement: ReversibleMovement): void {
  if (movement.type !== InventoryMovementType.RECEIPT) {
    throw new ConflictException('只有正常到货入库可以一键撤销');
  }
  if (movement.reversedBy) throw new ConflictException('该笔入库已经撤销');
  if (
    movement.bucket !== InventoryBucket.WAREHOUSE ||
    movement.quantityDelta < 1 ||
    movement.variant.status !== HoldStatus.ACTIVE ||
    movement.variant.holdModel.category.status !== HoldStatus.ACTIVE
  ) {
    throw new ConflictException('停用或异常入库流水不能直接撤销');
  }
}

function movementCommand(
  balance: HoldInventoryBalance,
  input: StockMovementInput,
  requestFingerprint: string,
): MovementCommand {
  if (input.type === InventoryMovementType.RECEIPT) return { ...input, requestFingerprint };
  if (input.expectedVersion !== balance.version) {
    throw new ConflictException('库存已经发生变化，请刷新后重新确认实际数量');
  }
  const beforeQuantity = balance[quantityFieldByBucket[input.bucket]];
  const quantityDelta = input.targetQuantity - beforeQuantity;
  if (!quantityDelta) throw new ConflictException('实际数量没有变化，无需调整');
  return { ...input, quantityDelta, requestFingerprint };
}

function reversalCommand(movement: ReversibleMovement, reason: string): MovementCommand {
  return {
    type: InventoryMovementType.REVERSAL,
    bucket: movement.bucket,
    quantityDelta: -movement.quantityDelta,
    note: reason,
    reversalOfMovementId: movement.id,
  };
}

function movementData(
  session: CurrentSession,
  variantId: string,
  input: MovementCommand,
  beforeQuantity: number,
  afterQuantity: number,
) {
  return {
    organizationId: session.organization.id,
    variantId,
    type: input.type,
    bucket: input.bucket,
    quantityDelta: input.quantityDelta,
    beforeQuantity,
    afterQuantity,
    note: input.note,
    referenceType: input.referenceType,
    referenceId: input.referenceId,
    reversalOfMovementId: input.reversalOfMovementId,
    requestKey: input.requestKey,
    requestFingerprint: input.requestFingerprint,
    actorAccountId: session.account.id,
  };
}

async function applyTransfer(
  transaction: Prisma.TransactionClient,
  audit: AuditService,
  session: CurrentSession,
  variant: ActiveVariant,
  input: HoldInventoryTransferInput,
  fingerprint: string,
) {
  const sourceField = quantityFieldByBucket[input.from];
  const targetField = quantityFieldByBucket[input.to];
  const sourceAfter = variant.inventory[sourceField] - input.quantity;
  if (sourceAfter < 0) throw new ConflictException('来源库存不足，无法完成上墙或下墙');
  const targetAfter = variant.inventory[targetField] + input.quantity;
  await updateBalance(transaction, variant.inventory, {
    [sourceField]: sourceAfter,
    [targetField]: targetAfter,
  });
  const type = transferMovementType(input.from, input.to);
  await transaction.holdInventoryMovement.createMany({
    data: transferMovementData(
      session,
      variant.id,
      input,
      fingerprint,
      type,
      sourceAfter,
      targetAfter,
      variant.inventory,
    ),
  });
  await recordTransferAudit(transaction, audit, session, variant, input);
  const updated = await transaction.holdInventoryBalance.findUniqueOrThrow({
    where: { id: variant.inventory.id },
  });
  return inventoryValues(updated);
}

function transferMovementType(from: InventoryBucket, to: InventoryBucket): InventoryMovementType {
  if (to === InventoryBucket.INSTALLED) return InventoryMovementType.INSTALL;
  if (from === InventoryBucket.INSTALLED) return InventoryMovementType.REMOVE;
  if (to === InventoryBucket.MAINTENANCE) return InventoryMovementType.MAINTENANCE_IN;
  if (from === InventoryBucket.MAINTENANCE) return InventoryMovementType.MAINTENANCE_OUT;
  if (to === InventoryBucket.RESERVED) return InventoryMovementType.RESERVE;
  if (from === InventoryBucket.RESERVED) return InventoryMovementType.RELEASE;
  return InventoryMovementType.ADJUSTMENT;
}

function transferMovementData(
  session: CurrentSession,
  variantId: string,
  input: HoldInventoryTransferInput,
  fingerprint: string,
  type: InventoryMovementType,
  sourceAfter: number,
  targetAfter: number,
  balance: HoldInventoryBalance,
) {
  const common = {
    organizationId: session.organization.id,
    variantId,
    type,
    note: input.note,
    referenceType: input.referenceType,
    referenceId: input.referenceId,
    actorAccountId: session.account.id,
  };
  return [
    {
      ...common,
      bucket: input.from,
      quantityDelta: -input.quantity,
      beforeQuantity: balance[quantityFieldByBucket[input.from]],
      afterQuantity: sourceAfter,
      requestKey: input.requestKey,
      requestFingerprint: fingerprint,
    },
    {
      ...common,
      bucket: input.to,
      quantityDelta: input.quantity,
      beforeQuantity: balance[quantityFieldByBucket[input.to]],
      afterQuantity: targetAfter,
    },
  ];
}

async function recordMovementAudit(
  transaction: Prisma.TransactionClient,
  audit: AuditService,
  session: CurrentSession,
  categoryId: string,
  variantId: string,
  input: MovementCommand,
): Promise<void> {
  await audit.record(
    {
      organizationId: session.organization.id,
      actorAccountId: session.account.id,
      type: 'hold.inventory.moved',
      outcome: 'SUCCESS',
      metadata: {
        categoryId,
        specificationId: variantId,
        movementType: input.type,
        bucket: input.bucket,
        quantityDelta: input.quantityDelta,
      },
    },
    transaction,
  );
}

async function recordTransferAudit(
  transaction: Prisma.TransactionClient,
  audit: AuditService,
  session: CurrentSession,
  variant: ActiveVariant,
  input: HoldInventoryTransferInput,
): Promise<void> {
  await audit.record(
    {
      organizationId: session.organization.id,
      actorAccountId: session.account.id,
      type: 'hold.inventory.transferred',
      outcome: 'SUCCESS',
      metadata: {
        categoryId: variant.holdModel.categoryId,
        specificationId: variant.id,
        from: input.from,
        to: input.to,
        quantity: input.quantity,
        referenceType: input.referenceType,
        referenceId: input.referenceId,
      },
    },
    transaction,
  );
}

function assertTransferInput(input: HoldInventoryTransferInput): void {
  if (input.from === input.to) throw new ConflictException('库存转移的来源和目标不能相同');
  if (!Number.isInteger(input.quantity) || input.quantity < 1) {
    throw new ConflictException('库存转移数量必须是正整数');
  }
  if (!input.referenceId.trim()) throw new ConflictException('库存转移必须关联墙面或线路记录');
}

function movementFingerprint(variantId: string, input: StockMovementInput): string {
  return input.type === InventoryMovementType.RECEIPT
    ? JSON.stringify([variantId, input.type, input.bucket, input.quantityDelta, input.note ?? null])
    : JSON.stringify([
        variantId,
        input.type,
        input.bucket,
        input.targetQuantity,
        input.expectedVersion,
        input.note,
      ]);
}

function transferFingerprint(input: HoldInventoryTransferInput): string {
  return JSON.stringify([
    input.variantId,
    input.from,
    input.to,
    input.quantity,
    input.referenceType,
    input.referenceId,
    input.note ?? null,
  ]);
}

const quantitySums = {
  warehouseQuantity: true,
  installedQuantity: true,
  reservedQuantity: true,
  maintenanceQuantity: true,
} as const;

const emptyQuantitySums = {
  warehouseQuantity: null,
  installedQuantity: null,
  reservedQuantity: null,
  maintenanceQuantity: null,
};

function buildSummary(
  categoryCount: number,
  specificationCount: number,
  quantities: {
    warehouseQuantity: number | null;
    installedQuantity: number | null;
    reservedQuantity: number | null;
    maintenanceQuantity: number | null;
  },
  unverifiedCount: number,
) {
  return {
    categoryCount,
    specificationCount,
    warehouseQuantity: quantities.warehouseQuantity ?? 0,
    installedQuantity: quantities.installedQuantity ?? 0,
    reservedQuantity: quantities.reservedQuantity ?? 0,
    maintenanceQuantity: quantities.maintenanceQuantity ?? 0,
    unverifiedCount,
  };
}
