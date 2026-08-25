import { ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import {
  FacilityStatus,
  HoldStatus,
  HoldTrackingMode,
  HoldUnitEventType,
  HoldUnitOperationalStatus,
  HoldUnitPhysicalStatus,
  Prisma,
  RfidTagStatus,
} from '@prisma/client';
import { randomUUID } from 'node:crypto';
import type { CurrentSession } from '../auth/session.service';
import { AuditService } from '../common/audit.service';
import { isPrismaError } from '../database/prisma-errors';
import { PrismaService } from '../database/prisma.service';
import { AccessControlService, Capability } from '../security/access-control.service';
import type { BindHoldUnitTagInput, ListHoldUnitsInput, RegisterHoldUnitsInput } from './hold.dto';
import { lockHoldOrganization } from './hold-transaction-lock';
import { refreshHoldTrackingMode, totalInventoryQuantity } from './hold-unit-tracking';

const unitInclude = {
  currentFacility: { select: { id: true, code: true, name: true } },
  tagBindings: {
    where: { unboundAt: null },
    include: { rfidTag: true },
    take: 1,
  },
} satisfies Prisma.HoldUnitInclude;

@Injectable()
export class HoldUnitService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly access: AccessControlService,
  ) {}

  async list(session: CurrentSession, specificationId: string, input: ListHoldUnitsInput) {
    this.access.assert(session, Capability.HOLD_READ);
    const variant = await this.findVariant(session.organization.id, specificationId);
    const where = unitFilter(session.organization.id, specificationId, input);
    const [units, total, taggedQuantity, grouped] = await this.prisma.$transaction([
      this.prisma.holdUnit.findMany({
        where,
        include: unitInclude,
        orderBy: { createdAt: 'asc' },
        skip: (input.page - 1) * input.pageSize,
        take: input.pageSize,
      }),
      this.prisma.holdUnit.count({ where }),
      this.prisma.holdUnit.count({
        where: {
          ownerOrganizationId: session.organization.id,
          holdVariantId: specificationId,
          operationalStatus: { not: HoldUnitOperationalStatus.RETIRED },
          tagBindings: { some: { unboundAt: null } },
        },
      }),
      this.prisma.holdUnit.groupBy({
        by: ['physicalStatus'],
        orderBy: { physicalStatus: 'asc' },
        where: {
          ownerOrganizationId: session.organization.id,
          holdVariantId: specificationId,
          operationalStatus: { not: HoldUnitOperationalStatus.RETIRED },
        },
        _count: { _all: true },
      }),
    ]);
    return {
      items: units.map(toUnitSummary),
      total,
      page: input.page,
      pageSize: input.pageSize,
      tracking: buildTrackingSummary(
        variant,
        taggedQuantity,
        grouped as Array<{
          physicalStatus: HoldUnitPhysicalStatus;
          _count: { _all: number };
        }>,
      ),
    };
  }

  async registerBatch(
    session: CurrentSession,
    specificationId: string,
    input: RegisterHoldUnitsInput,
  ) {
    this.access.assert(session, Capability.HOLD_WRITE);
    try {
      return await this.prisma.$transaction(async (transaction) => {
        await lockHoldOrganization(transaction, session.organization.id);
        const replay = await transaction.holdUnitRegistrationBatch.findUnique({
          where: {
            organizationId_requestKey: {
              organizationId: session.organization.id,
              requestKey: input.requestKey,
            },
          },
          include: { units: { include: unitInclude, orderBy: { createdAt: 'asc' } } },
        });
        if (replay) {
          if (
            replay.holdVariantId !== specificationId ||
            replay.quantity !== input.quantity ||
            replay.physicalStatus !== input.physicalStatus
          ) {
            throw new ConflictException('请求标识已用于其他物理岩点建档操作');
          }
          const replayVariant = await this.findVariant(
            session.organization.id,
            specificationId,
            transaction,
          );
          return registrationResult(replay.units, replayVariant.trackingMode, true);
        }

        const variant = await this.findVariant(
          session.organization.id,
          specificationId,
          transaction,
        );
        if (variant.status !== HoldStatus.ACTIVE) {
          throw new ConflictException('停用档案不能管理物理岩点');
        }
        const limit = bucketQuantity(variant.inventory, input.physicalStatus);
        const registered = await transaction.holdUnit.count({
          where: {
            ownerOrganizationId: session.organization.id,
            holdVariantId: specificationId,
            physicalStatus: input.physicalStatus,
            operationalStatus: { not: HoldUnitOperationalStatus.RETIRED },
          },
        });
        if (registered + input.quantity > limit) {
          throw new ConflictException(
            `该位置仅剩 ${Math.max(0, limit - registered)} 颗未建立物理身份，不能重复建档`,
          );
        }

        const facility = await ensureDefaultFacility(transaction, session);
        const batch = await transaction.holdUnitRegistrationBatch.create({
          data: {
            organizationId: session.organization.id,
            holdVariantId: specificationId,
            facilityId: facility.id,
            requestKey: input.requestKey,
            physicalStatus: input.physicalStatus,
            quantity: input.quantity,
            createdByAccountId: session.account.id,
          },
        });
        const unitData = Array.from({ length: input.quantity }, () => ({
          assetCode: createAssetCode(),
          holdVariantId: specificationId,
          ownerOrganizationId: session.organization.id,
          currentCustodianOrganizationId: session.organization.id,
          currentFacilityId: facility.id,
          registrationBatchId: batch.id,
          physicalStatus: input.physicalStatus,
          registeredByAccountId: session.account.id,
        }));
        await transaction.holdUnit.createMany({ data: unitData });
        const units = await transaction.holdUnit.findMany({
          where: { registrationBatchId: batch.id },
          include: unitInclude,
          orderBy: { createdAt: 'asc' },
        });
        await transaction.holdUnitEvent.createMany({
          data: units.map((unit, index) => ({
            organizationId: session.organization.id,
            holdUnitId: unit.id,
            type: HoldUnitEventType.REGISTERED,
            actorAccountId: session.account.id,
            requestKey: `${input.requestKey}:${index + 1}`,
            toCustodianOrganizationId: session.organization.id,
            toFacilityId: facility.id,
            metadata: {
              batchId: batch.id,
              physicalStatus: input.physicalStatus,
            },
          })),
        });
        const trackingMode = await refreshHoldTrackingMode(
          transaction,
          variant.id,
          variant.inventory,
        );
        await this.audit.record(
          {
            organizationId: session.organization.id,
            actorAccountId: session.account.id,
            type: 'hold.units.registered',
            outcome: 'SUCCESS',
            metadata: {
              batchId: batch.id,
              specificationId,
              quantity: input.quantity,
              physicalStatus: input.physicalStatus,
              trackingMode,
            },
          },
          transaction,
        );
        return registrationResult(units, trackingMode, false);
      });
    } catch (error) {
      if (isPrismaError(error, 'P2002')) {
        throw new ConflictException('资产编号、RFID 标识或请求标识发生冲突，请重试');
      }
      throw error;
    }
  }

  async bindTag(session: CurrentSession, unitId: string, input: BindHoldUnitTagInput) {
    this.access.assert(session, Capability.HOLD_WRITE);
    try {
      return await this.prisma.$transaction(async (transaction) => {
        await lockHoldOrganization(transaction, session.organization.id);
        const replay = await transaction.holdUnitEvent.findUnique({
          where: {
            organizationId_requestKey: {
              organizationId: session.organization.id,
              requestKey: input.requestKey,
            },
          },
        });
        if (replay) {
          const replayEpc = jsonString(replay.metadata, 'epc');
          if (replay.holdUnitId !== unitId || replayEpc !== input.epc) {
            throw new ConflictException('请求标识已用于其他标签绑定操作');
          }
          return toUnitSummary(await findUnit(transaction, session.organization.id, unitId));
        }

        const unit = await findUnit(transaction, session.organization.id, unitId, true);
        const currentBinding = unit.tagBindings[0];
        if (currentBinding?.rfidTag.epc === input.epc) {
          if (input.tid && currentBinding.rfidTag.tid && currentBinding.rfidTag.tid !== input.tid) {
            throw new ConflictException('该 EPC 已绑定，但 TID 与当前标签不一致');
          }
          return toUnitSummary(unit);
        }

        const existingTag = await transaction.rfidTag.findUnique({
          where: { epc: input.epc },
          include: { bindings: { where: { unboundAt: null }, take: 1 } },
        });
        if (existingTag && existingTag.organizationId !== session.organization.id) {
          throw new ConflictException('该 EPC 已属于其他组织');
        }
        const activeUnitId = existingTag?.bindings[0]?.holdUnitId;
        if (activeUnitId && activeUnitId !== unitId) {
          throw new ConflictException('该 RFID 标签已经绑定到另一颗岩点');
        }
        if (input.tid) {
          const tidTag = await transaction.rfidTag.findUnique({ where: { tid: input.tid } });
          if (tidTag && tidTag.id !== existingTag?.id) {
            throw new ConflictException('该 TID 已属于另一枚 RFID 标签');
          }
          if (existingTag?.tid && existingTag.tid !== input.tid) {
            throw new ConflictException('该 EPC 对应的 TID 与历史记录不一致');
          }
        }

        const now = new Date();
        if (currentBinding) {
          await transaction.holdUnitTagBinding.update({
            where: { id: currentBinding.id },
            data: { unboundAt: now, unbindReason: '标签更换' },
          });
          await transaction.rfidTag.update({
            where: { id: currentBinding.rfidTagId },
            data: { status: RfidTagStatus.REPLACED },
          });
        }
        const tag = existingTag
          ? await transaction.rfidTag.update({
              where: { id: existingTag.id },
              data: { tid: input.tid ?? existingTag.tid, status: RfidTagStatus.ACTIVE },
            })
          : await transaction.rfidTag.create({
              data: {
                organizationId: session.organization.id,
                epc: input.epc,
                tid: input.tid,
              },
            });
        await transaction.holdUnitTagBinding.create({
          data: {
            holdUnitId: unitId,
            rfidTagId: tag.id,
            boundByAccountId: session.account.id,
          },
        });
        const eventType = currentBinding
          ? HoldUnitEventType.TAG_REPLACED
          : HoldUnitEventType.TAG_BOUND;
        await transaction.holdUnitEvent.create({
          data: {
            organizationId: session.organization.id,
            holdUnitId: unitId,
            type: eventType,
            actorAccountId: session.account.id,
            requestKey: input.requestKey,
            metadata: {
              epc: input.epc,
              tid: input.tid ?? null,
              previousEpc: currentBinding?.rfidTag.epc ?? null,
            },
          },
        });
        await this.audit.record(
          {
            organizationId: session.organization.id,
            actorAccountId: session.account.id,
            type: currentBinding ? 'hold.unit.tag.replaced' : 'hold.unit.tag.bound',
            outcome: 'SUCCESS',
            metadata: { unitId, epc: input.epc },
          },
          transaction,
        );
        return toUnitSummary(await findUnit(transaction, session.organization.id, unitId));
      });
    } catch (error) {
      if (isPrismaError(error, 'P2002')) {
        throw new ConflictException('该 EPC、TID 或请求标识已经被使用');
      }
      throw error;
    }
  }

  private async findVariant(
    organizationId: string,
    specificationId: string,
    client: Pick<PrismaService, 'holdVariant'> | Prisma.TransactionClient = this.prisma,
  ) {
    const variant = await client.holdVariant.findFirst({
      where: {
        id: specificationId,
        deletedAt: null,
        holdModel: { organizationId },
      },
      include: { inventory: true },
    });
    if (!variant?.inventory) throw new NotFoundException('岩点档案或库存不存在');
    return { ...variant, inventory: variant.inventory };
  }
}

function unitFilter(organizationId: string, specificationId: string, input: ListHoldUnitsInput) {
  return {
    ownerOrganizationId: organizationId,
    holdVariantId: specificationId,
    ...(input.physicalStatus ? { physicalStatus: input.physicalStatus } : {}),
    ...(input.search
      ? {
          OR: [
            { assetCode: { contains: input.search, mode: Prisma.QueryMode.insensitive } },
            {
              tagBindings: {
                some: {
                  unboundAt: null,
                  rfidTag: { epc: { contains: input.search, mode: Prisma.QueryMode.insensitive } },
                },
              },
            },
          ],
        }
      : {}),
    ...(input.tagged === 'true'
      ? { tagBindings: { some: { unboundAt: null } } }
      : input.tagged === 'false'
        ? { tagBindings: { none: { unboundAt: null } } }
        : {}),
  } satisfies Prisma.HoldUnitWhereInput;
}

async function ensureDefaultFacility(
  transaction: Prisma.TransactionClient,
  session: CurrentSession,
) {
  const existing = await transaction.facility.findFirst({
    where: { organizationId: session.organization.id, status: FacilityStatus.ACTIVE },
    orderBy: [{ isDefault: 'desc' }, { createdAt: 'asc' }],
  });
  if (existing) return existing;
  return transaction.facility.create({
    data: {
      organizationId: session.organization.id,
      code: 'DEFAULT',
      name: session.organization.name,
      isDefault: true,
    },
  });
}

async function findUnit(
  transaction: Prisma.TransactionClient,
  organizationId: string,
  unitId: string,
  requireActive = false,
) {
  const unit = await transaction.holdUnit.findFirst({
    where: {
      id: unitId,
      ownerOrganizationId: organizationId,
      ...(requireActive
        ? {
            operationalStatus: { not: HoldUnitOperationalStatus.RETIRED },
            holdVariant: { status: HoldStatus.ACTIVE, deletedAt: null },
          }
        : {}),
    },
    include: unitInclude,
  });
  if (!unit) {
    throw new NotFoundException(
      requireActive ? '物理岩点不存在或岩点档案已停用' : '物理岩点不存在',
    );
  }
  return unit;
}

function bucketQuantity(
  inventory: {
    warehouseQuantity: number;
    installedQuantity: number;
  },
  status: HoldUnitPhysicalStatus,
): number {
  if (status === HoldUnitPhysicalStatus.WAREHOUSE) return inventory.warehouseQuantity;
  if (status === HoldUnitPhysicalStatus.INSTALLED) return inventory.installedQuantity;
  throw new ConflictException('当前只支持将仓库或已上墙数量建立为物理岩点');
}

function buildTrackingSummary(
  variant: {
    trackingMode: HoldTrackingMode;
    inventory: {
      warehouseQuantity: number;
      installedQuantity: number;
      reservedQuantity: number;
      maintenanceQuantity: number;
      verificationStatus: string;
      version: number;
    };
  },
  taggedQuantity: number,
  grouped: Array<{ physicalStatus: HoldUnitPhysicalStatus; _count: { _all: number } }>,
) {
  const counts = Object.fromEntries(grouped.map((item) => [item.physicalStatus, item._count._all]));
  const inventory = {
    ...variant.inventory,
    totalQuantity: totalInventoryQuantity(variant.inventory),
  };
  const warehouseRegistered = counts[HoldUnitPhysicalStatus.WAREHOUSE] ?? 0;
  const installedRegistered = counts[HoldUnitPhysicalStatus.INSTALLED] ?? 0;
  const registeredQuantity = Object.values(counts).reduce((sum, value) => sum + value, 0);
  return {
    mode: variant.trackingMode,
    registeredQuantity,
    taggedQuantity,
    unregisteredQuantity: Math.max(0, inventory.totalQuantity - registeredQuantity),
    warehouseRegistered,
    warehouseRemaining: Math.max(0, inventory.warehouseQuantity - warehouseRegistered),
    installedRegistered,
    installedRemaining: Math.max(0, inventory.installedQuantity - installedRegistered),
    totalQuantity: inventory.totalQuantity,
  };
}

function registrationResult(
  units: Array<Prisma.HoldUnitGetPayload<{ include: typeof unitInclude }>>,
  trackingMode: HoldTrackingMode,
  replayed: boolean,
) {
  return {
    createdCount: units.length,
    trackingMode,
    replayed,
    items: units.map(toUnitSummary),
  };
}

function toUnitSummary(unit: Prisma.HoldUnitGetPayload<{ include: typeof unitInclude }>) {
  const tag = unit.tagBindings[0]?.rfidTag;
  return {
    id: unit.id,
    assetCode: unit.assetCode,
    physicalStatus: unit.physicalStatus,
    operationalStatus: unit.operationalStatus,
    ownerOrganizationId: unit.ownerOrganizationId,
    currentCustodianOrganizationId: unit.currentCustodianOrganizationId,
    facility: unit.currentFacility,
    tag: tag
      ? { id: tag.id, epc: tag.epc, tid: tag.tid, technology: tag.technology, status: tag.status }
      : null,
    version: unit.version,
    createdAt: unit.createdAt.toISOString(),
    updatedAt: unit.updatedAt.toISOString(),
  };
}

function createAssetCode(): string {
  return `HLD-${randomUUID().replaceAll('-', '').slice(0, 12).toUpperCase()}`;
}

function jsonString(value: Prisma.JsonValue | null, key: string): string | undefined {
  if (!value || Array.isArray(value) || typeof value !== 'object') return undefined;
  const candidate = value[key];
  return typeof candidate === 'string' ? candidate : undefined;
}
