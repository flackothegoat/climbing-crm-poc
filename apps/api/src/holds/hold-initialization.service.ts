import { ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import {
  HoldInitializationStatus,
  HoldStatus,
  InventoryBucket,
  InventoryMovementType,
  Prisma,
} from '@prisma/client';
import type { CurrentSession } from '../auth/session.service';
import { AuditService } from '../common/audit.service';
import { isPrismaError } from '../database/prisma-errors';
import { PrismaService } from '../database/prisma.service';
import { AccessControlService, Capability } from '../security/access-control.service';
import type { InitializeSpecificationInput, StartInitializationInput } from './hold.dto';
import { lockHoldOrganization } from './hold-transaction-lock';

@Injectable()
export class HoldInitializationService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly access: AccessControlService,
  ) {}

  async getActive(session: CurrentSession) {
    this.access.assert(session, Capability.HOLD_READ);
    const batch = await this.prisma.holdInitializationBatch.findUnique({
      where: { activeKey: session.organization.id },
      include: batchSummaryInclude,
    });
    return batch ? toBatchSummary(batch) : null;
  }

  async start(session: CurrentSession, input: StartInitializationInput) {
    this.access.assert(session, Capability.HOLD_RECEIVE);
    try {
      return await this.prisma.$transaction(async (transaction) => {
        await lockHoldOrganization(transaction, session.organization.id);
        const batch = await transaction.holdInitializationBatch.create({
          data: {
            organizationId: session.organization.id,
            activeKey: session.organization.id,
            name: input.name,
            startedByAccountId: session.account.id,
          },
          include: batchSummaryInclude,
        });
        await this.recordAudit(session, batch.id, 'hold.initialization.started', {}, transaction);
        return toBatchSummary(batch);
      });
    } catch (error) {
      if (isPrismaError(error, 'P2002')) throw new ConflictException('已有进行中的初始化批次');
      throw error;
    }
  }

  async complete(session: CurrentSession, batchId: string): Promise<void> {
    this.access.assert(session, Capability.HOLD_RECEIVE);
    await this.prisma.$transaction(async (transaction) => {
      await lockHoldOrganization(transaction, session.organization.id);
      const batch = await this.findOwnedActiveBatch(transaction, session.organization.id, batchId);
      if (!batch._count.entries) throw new ConflictException('至少完成一组岩点盘点后才能结束批次');
      if (batch._count.scans) throw new ConflictException('仍有未完成的扫描建档，请先完成或取消');
      const missingCount = await countUninitializedSpecifications(
        transaction,
        session.organization.id,
        batchId,
      );
      if (missingCount) {
        throw new ConflictException(`还有 ${missingCount} 个在用岩点档案尚未盘点，不能结束初始化`);
      }
      await transaction.holdInitializationBatch.update({
        where: { id: batchId },
        data: {
          activeKey: null,
          status: HoldInitializationStatus.COMPLETED,
          completedByAccountId: session.account.id,
          completedAt: new Date(),
        },
      });
      await this.recordAudit(session, batchId, 'hold.initialization.completed', {}, transaction);
    });
  }

  async cancelEmpty(session: CurrentSession, batchId: string): Promise<void> {
    this.access.assert(session, Capability.HOLD_RECEIVE);
    await this.prisma.$transaction(async (transaction) => {
      await lockHoldOrganization(transaction, session.organization.id);
      const batch = await this.findOwnedActiveBatch(transaction, session.organization.id, batchId);
      if (batch._count.entries || batch._count.scans) {
        throw new ConflictException('已有盘点记录或扫描草稿，不能取消该批次');
      }
      await transaction.holdInitializationBatch.update({
        where: { id: batchId },
        data: { activeKey: null, status: HoldInitializationStatus.CANCELLED },
      });
      await this.recordAudit(session, batchId, 'hold.initialization.cancelled', {}, transaction);
    });
  }

  async initializeExisting(
    session: CurrentSession,
    specificationId: string,
    input: InitializeSpecificationInput,
  ) {
    this.access.assert(session, Capability.HOLD_RECEIVE);
    const result = await this.prisma.$transaction(async (transaction) => {
      await lockHoldOrganization(transaction, session.organization.id);
      await this.assertActiveSpecification(transaction, session.organization.id, specificationId);
      const entry = await this.addEntry(
        transaction,
        session,
        input.batchId,
        specificationId,
        input,
      );
      await this.recordAudit(
        session,
        input.batchId,
        'hold.initialization.entry.created',
        { specificationId },
        transaction,
      );
      return entry;
    });
    return result;
  }

  async addEntry(
    transaction: Prisma.TransactionClient,
    session: CurrentSession,
    batchId: string,
    specificationId: string,
    counts: InitializationCounts,
    scanId?: string,
  ) {
    await this.findOwnedActiveBatch(transaction, session.organization.id, batchId);
    const balance = await transaction.holdInventoryBalance.findUnique({
      where: { variantId: specificationId },
    });
    if (!balance) throw new NotFoundException('岩点库存余额不存在');
    try {
      const entry = await transaction.holdInitializationEntry.create({
        data: entryData(session, batchId, specificationId, counts, scanId),
      });
      await applyObservedBalances(transaction, session, balance, counts, entry.id);
      return entry;
    } catch (error) {
      if (isPrismaError(error, 'P2002')) throw new ConflictException('该规格已加入当前初始化批次');
      throw error;
    }
  }

  private async assertActiveSpecification(
    transaction: Prisma.TransactionClient,
    organizationId: string,
    specificationId: string,
  ): Promise<void> {
    const specification = await transaction.holdVariant.findFirst({
      where: {
        id: specificationId,
        status: HoldStatus.ACTIVE,
        deletedAt: null,
        holdModel: { organizationId, category: { status: HoldStatus.ACTIVE } },
      },
      select: { id: true },
    });
    if (!specification) throw new NotFoundException('可初始化的岩点规格不存在');
  }

  private async findOwnedActiveBatch(client: BatchClient, organizationId: string, batchId: string) {
    const batch = await client.holdInitializationBatch.findFirst({
      where: { id: batchId, organizationId, status: HoldInitializationStatus.ACTIVE },
      include: { _count: { select: { entries: true, scans: { where: { status: 'DRAFT' } } } } },
    });
    if (!batch) throw new NotFoundException('进行中的初始化批次不存在');
    return batch;
  }

  private recordAudit(
    session: CurrentSession,
    batchId: string,
    type: string,
    metadata: Record<string, unknown> = {},
    client?: Prisma.TransactionClient,
  ): Promise<unknown> {
    return this.audit.record(
      {
        organizationId: session.organization.id,
        actorAccountId: session.account.id,
        type,
        outcome: 'SUCCESS',
        metadata: { batchId, ...metadata },
      },
      client,
    );
  }
}

interface InitializationCounts {
  warehouseQuantity: number;
  installedQuantity: number;
  note?: string | null;
}

type BatchClient = Pick<PrismaService, 'holdInitializationBatch'> | Prisma.TransactionClient;
type InventoryBalance = Prisma.HoldInventoryBalanceGetPayload<Record<string, never>>;

function countUninitializedSpecifications(
  transaction: Prisma.TransactionClient,
  organizationId: string,
  batchId: string,
): Promise<number> {
  return transaction.holdVariant.count({
    where: {
      status: HoldStatus.ACTIVE,
      deletedAt: null,
      holdModel: { organizationId, category: { status: HoldStatus.ACTIVE } },
      initializationEntries: { none: { batchId } },
    },
  });
}

const batchSummaryInclude = {
  entries: {
    select: { specificationId: true, warehouseQuantity: true, installedQuantity: true },
  },
  _count: { select: { scans: { where: { status: 'DRAFT' as const } } } },
};

function toBatchSummary(
  batch: Prisma.HoldInitializationBatchGetPayload<{
    include: typeof batchSummaryInclude;
  }>,
) {
  const totals = batch.entries.reduce(
    (sum, entry) => ({
      warehouseQuantity: sum.warehouseQuantity + entry.warehouseQuantity,
      installedQuantity: sum.installedQuantity + entry.installedQuantity,
    }),
    { warehouseQuantity: 0, installedQuantity: 0 },
  );
  return {
    id: batch.id,
    name: batch.name,
    status: batch.status,
    entryCount: batch.entries.length,
    draftScanCount: batch._count.scans,
    specificationIds: batch.entries.map((entry) => entry.specificationId),
    ...totals,
    createdAt: batch.createdAt.toISOString(),
  };
}

function entryData(
  session: CurrentSession,
  batchId: string,
  specificationId: string,
  counts: InitializationCounts,
  scanId?: string,
) {
  return {
    batchId,
    specificationId,
    scanId,
    warehouseQuantity: counts.warehouseQuantity,
    installedQuantity: counts.installedQuantity,
    note: counts.note,
    createdByAccountId: session.account.id,
  };
}

async function applyObservedBalances(
  transaction: Prisma.TransactionClient,
  session: CurrentSession,
  balance: InventoryBalance,
  counts: InitializationCounts,
  entryId: string,
): Promise<void> {
  const changes = [
    inventoryChange(InventoryBucket.WAREHOUSE, balance.warehouseQuantity, counts.warehouseQuantity),
    inventoryChange(InventoryBucket.INSTALLED, balance.installedQuantity, counts.installedQuantity),
  ].filter((item) => item.quantityDelta !== 0);
  const updated = await transaction.holdInventoryBalance.updateMany({
    where: { id: balance.id, version: balance.version },
    data: {
      warehouseQuantity: counts.warehouseQuantity,
      installedQuantity: counts.installedQuantity,
      verificationStatus: 'VERIFIED',
      version: { increment: 1 },
    },
  });
  if (!updated.count) throw new ConflictException('库存已变化，请刷新后重新确认盘点数量');
  if (changes.length) {
    await transaction.holdInventoryMovement.createMany({
      data: changes.map((change) =>
        movementData(session, balance.variantId, change, counts, entryId),
      ),
    });
  }
}

function inventoryChange(bucket: InventoryBucket, beforeQuantity: number, afterQuantity: number) {
  return { bucket, beforeQuantity, afterQuantity, quantityDelta: afterQuantity - beforeQuantity };
}

function movementData(
  session: CurrentSession,
  variantId: string,
  change: ReturnType<typeof inventoryChange>,
  counts: InitializationCounts,
  entryId: string,
) {
  return {
    organizationId: session.organization.id,
    variantId,
    type: InventoryMovementType.INITIAL_BALANCE,
    ...change,
    note: counts.note ?? '全馆岩点初始化盘点',
    referenceType: 'HOLD_INITIALIZATION_ENTRY',
    referenceId: entryId,
    actorAccountId: session.account.id,
  };
}
