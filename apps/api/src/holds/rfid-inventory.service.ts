import { ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import {
  FacilityStatus,
  HoldUnitEventType,
  HoldUnitOperationalStatus,
  Prisma,
  RfidInventoryMatchStatus,
  RfidInventorySessionStatus,
  RfidTagStatus,
} from '@prisma/client';
import type { CurrentSession } from '../auth/session.service';
import { AuditService } from '../common/audit.service';
import { isPrismaError } from '../database/prisma-errors';
import { PrismaService } from '../database/prisma.service';
import { AccessControlService, Capability } from '../security/access-control.service';
import { lockHoldOrganization } from './hold-transaction-lock';
import type {
  CreateRfidInventorySessionInput,
  IngestRfidInventoryReadsInput,
  ListRfidInventorySessionsInput,
  TransitionRfidInventorySessionInput,
} from './rfid-inventory.dto';
import { classifyRfidRead, epcFrequencies, rfidReadFingerprint } from './rfid-inventory-matching';

const sessionListInclude = {
  facility: { select: { id: true, code: true, name: true } },
  _count: { select: { observations: true, expectedUnits: true, readBatches: true } },
} satisfies Prisma.RfidInventorySessionInclude;

const observationInclude = {
  holdUnit: {
    select: {
      id: true,
      assetCode: true,
      physicalStatus: true,
      currentFacility: { select: { id: true, code: true, name: true } },
      holdVariant: {
        select: {
          color: true,
          holdModel: { select: { name: true, brand: true } },
        },
      },
    },
  },
} satisfies Prisma.RfidInventoryObservationInclude;

@Injectable()
export class RfidInventoryService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly access: AccessControlService,
  ) {}

  async list(session: CurrentSession, input: ListRfidInventorySessionsInput) {
    this.access.assert(session, Capability.HOLD_READ);
    const [items, facilities] = await this.prisma.$transaction([
      this.prisma.rfidInventorySession.findMany({
        where: {
          organizationId: session.organization.id,
          ...(input.status ? { status: input.status } : {}),
        },
        include: sessionListInclude,
        orderBy: { createdAt: 'desc' },
        take: input.pageSize,
      }),
      this.prisma.facility.findMany({
        where: { organizationId: session.organization.id, status: FacilityStatus.ACTIVE },
        select: { id: true, code: true, name: true, isDefault: true },
        orderBy: [{ isDefault: 'desc' }, { createdAt: 'asc' }],
      }),
    ]);
    return { items: items.map(toSessionListItem), facilities };
  }

  async get(session: CurrentSession, sessionId: string) {
    this.access.assert(session, Capability.HOLD_READ);
    return this.getDetail(session.organization.id, sessionId);
  }

  async create(session: CurrentSession, input: CreateRfidInventorySessionInput) {
    this.access.assert(session, Capability.HOLD_WRITE);
    try {
      const sessionId = await this.prisma.$transaction(async (transaction) => {
        await lockHoldOrganization(transaction, session.organization.id);
        const replay = await transaction.rfidInventorySession.findUnique({
          where: {
            organizationId_requestKey: {
              organizationId: session.organization.id,
              requestKey: input.requestKey,
            },
          },
        });
        if (replay) {
          if (
            replay.name !== input.name ||
            replay.targetPhysicalStatus !== input.targetPhysicalStatus ||
            (input.facilityId && replay.facilityId !== input.facilityId)
          ) {
            throw new ConflictException('请求标识已用于其他 RFID 盘点会话');
          }
          return replay.id;
        }

        const facility = await resolveFacility(transaction, session, input.facilityId);
        const created = await transaction.rfidInventorySession.create({
          data: {
            organizationId: session.organization.id,
            facilityId: facility.id,
            requestKey: input.requestKey,
            name: input.name,
            targetPhysicalStatus: input.targetPhysicalStatus,
            createdByAccountId: session.account.id,
          },
        });
        const expected = await transaction.holdUnit.findMany({
          where: {
            currentCustodianOrganizationId: session.organization.id,
            currentFacilityId: facility.id,
            physicalStatus: input.targetPhysicalStatus,
            operationalStatus: HoldUnitOperationalStatus.ACTIVE,
            tagBindings: {
              some: { unboundAt: null, rfidTag: { status: RfidTagStatus.ACTIVE } },
            },
          },
          select: {
            id: true,
            tagBindings: {
              where: { unboundAt: null, rfidTag: { status: RfidTagStatus.ACTIVE } },
              select: { rfidTag: { select: { id: true, epc: true } } },
              take: 1,
            },
          },
        });
        if (expected.length) {
          await transaction.rfidInventoryExpectedUnit.createMany({
            data: expected.map((unit) => ({
              sessionId: created.id,
              holdUnitId: unit.id,
              rfidTagId: unit.tagBindings[0]!.rfidTag.id,
              epc: unit.tagBindings[0]!.rfidTag.epc,
            })),
          });
        }
        await this.audit.record(
          {
            organizationId: session.organization.id,
            actorAccountId: session.account.id,
            type: 'hold.rfid.inventory.started',
            outcome: 'SUCCESS',
            metadata: {
              sessionId: created.id,
              facilityId: facility.id,
              targetPhysicalStatus: input.targetPhysicalStatus,
              expectedQuantity: expected.length,
            },
          },
          transaction,
        );
        return created.id;
      });
      return this.getDetail(session.organization.id, sessionId);
    } catch (error) {
      if (isPrismaError(error, 'P2002')) {
        throw new ConflictException('该场馆和目标状态已有进行中的 RFID 盘点');
      }
      throw error;
    }
  }

  async ingest(session: CurrentSession, sessionId: string, input: IngestRfidInventoryReadsInput) {
    this.access.assert(session, Capability.HOLD_WRITE);
    await this.prisma.$transaction(async (transaction) => {
      await lockHoldOrganization(transaction, session.organization.id);
      const inventorySession = await findOpenSession(
        transaction,
        session.organization.id,
        sessionId,
      );
      const frequencies = epcFrequencies(input.epcs);
      const fingerprint = rfidReadFingerprint(frequencies);
      const replay = await transaction.rfidInventoryReadBatch.findUnique({
        where: {
          organizationId_requestKey: {
            organizationId: session.organization.id,
            requestKey: input.requestKey,
          },
        },
      });
      if (replay) {
        if (replay.sessionId !== sessionId || replay.requestFingerprint !== fingerprint) {
          throw new ConflictException('请求标识已用于其他 RFID 读取批次');
        }
        return;
      }

      const epcs = [...frequencies.keys()];
      const [expected, tags] = await Promise.all([
        transaction.rfidInventoryExpectedUnit.findMany({
          where: { sessionId, epc: { in: epcs } },
        }),
        transaction.rfidTag.findMany({
          where: { epc: { in: epcs } },
          include: {
            bindings: {
              where: { unboundAt: null },
              include: { holdUnit: true },
              take: 1,
            },
          },
        }),
      ]);
      const expectedByEpc = new Map(expected.map((item) => [item.epc, item]));
      const tagByEpc = new Map(tags.map((tag) => [tag.epc, tag]));
      const observations = epcs.map((epc) =>
        classifyRfidRead(epc, expectedByEpc.get(epc), tagByEpc.get(epc), session.organization.id),
      );
      const now = new Date();
      for (let offset = 0; offset < observations.length; offset += 50) {
        await Promise.all(
          observations.slice(offset, offset + 50).map((observation) =>
            transaction.rfidInventoryObservation.upsert({
              where: { sessionId_epc: { sessionId, epc: observation.epc } },
              create: {
                sessionId,
                ...observation,
                readCount: frequencies.get(observation.epc)!,
                firstSeenAt: now,
                lastSeenAt: now,
              },
              update: {
                matchStatus: observation.matchStatus,
                rfidTagId: observation.rfidTagId,
                holdUnitId: observation.holdUnitId,
                readCount: { increment: frequencies.get(observation.epc)! },
                lastSeenAt: now,
              },
            }),
          ),
        );
      }
      await transaction.rfidInventoryReadBatch.create({
        data: {
          organizationId: session.organization.id,
          sessionId,
          requestKey: input.requestKey,
          requestFingerprint: fingerprint,
          submittedCount: input.epcs.length,
          uniqueCount: epcs.length,
          createdByAccountId: session.account.id,
        },
      });
      await this.audit.record(
        {
          organizationId: session.organization.id,
          actorAccountId: session.account.id,
          type: 'hold.rfid.inventory.reads_ingested',
          outcome: 'SUCCESS',
          metadata: {
            sessionId: inventorySession.id,
            submittedCount: input.epcs.length,
            uniqueCount: epcs.length,
          },
        },
        transaction,
      );
    });
    return this.getDetail(session.organization.id, sessionId);
  }

  async complete(
    session: CurrentSession,
    sessionId: string,
    input: TransitionRfidInventorySessionInput,
  ) {
    this.access.assert(session, Capability.HOLD_WRITE);
    await this.prisma.$transaction(async (transaction) => {
      await lockHoldOrganization(transaction, session.organization.id);
      const inventorySession = await findSession(transaction, session.organization.id, sessionId);
      if (inventorySession.status === RfidInventorySessionStatus.COMPLETED) return;
      if (inventorySession.status === RfidInventorySessionStatus.CANCELLED) {
        throw new ConflictException('已取消的盘点不能完成');
      }
      assertVersion(inventorySession.version, input.expectedVersion);
      const observedCount = await transaction.rfidInventoryObservation.count({
        where: { sessionId },
      });
      if (!observedCount) throw new ConflictException('至少读取一枚标签后才能完成盘点');
      const matched = await transaction.rfidInventoryObservation.findMany({
        where: { sessionId, matchStatus: RfidInventoryMatchStatus.MATCHED_EXPECTED },
        select: { holdUnitId: true, epc: true },
      });
      if (matched.length) {
        await transaction.holdUnitEvent.createMany({
          data: matched.map((item) => ({
            organizationId: session.organization.id,
            holdUnitId: item.holdUnitId!,
            type: HoldUnitEventType.INVENTORY_CONFIRMED,
            actorAccountId: session.account.id,
            requestKey: `rfid-inventory:${sessionId}:${item.holdUnitId}`,
            toCustodianOrganizationId: session.organization.id,
            toFacilityId: inventorySession.facilityId,
            metadata: { sessionId, epc: item.epc },
          })),
          skipDuplicates: true,
        });
      }
      const updated = await transaction.rfidInventorySession.updateMany({
        where: {
          id: sessionId,
          status: RfidInventorySessionStatus.OPEN,
          version: input.expectedVersion,
        },
        data: {
          status: RfidInventorySessionStatus.COMPLETED,
          completedByAccountId: session.account.id,
          completedAt: new Date(),
          version: { increment: 1 },
        },
      });
      if (!updated.count) throw new ConflictException('盘点已发生变化，请刷新后重试');
      await this.audit.record(
        {
          organizationId: session.organization.id,
          actorAccountId: session.account.id,
          type: 'hold.rfid.inventory.completed',
          outcome: 'SUCCESS',
          metadata: { sessionId, observedCount, confirmedCount: matched.length },
        },
        transaction,
      );
    });
    return this.getDetail(session.organization.id, sessionId);
  }

  async cancel(
    session: CurrentSession,
    sessionId: string,
    input: TransitionRfidInventorySessionInput,
  ) {
    this.access.assert(session, Capability.HOLD_WRITE);
    await this.prisma.$transaction(async (transaction) => {
      await lockHoldOrganization(transaction, session.organization.id);
      const inventorySession = await findSession(transaction, session.organization.id, sessionId);
      if (inventorySession.status === RfidInventorySessionStatus.CANCELLED) return;
      if (inventorySession.status === RfidInventorySessionStatus.COMPLETED) {
        throw new ConflictException('已完成的盘点不能取消');
      }
      assertVersion(inventorySession.version, input.expectedVersion);
      const updated = await transaction.rfidInventorySession.updateMany({
        where: {
          id: sessionId,
          status: RfidInventorySessionStatus.OPEN,
          version: input.expectedVersion,
        },
        data: {
          status: RfidInventorySessionStatus.CANCELLED,
          cancelledAt: new Date(),
          version: { increment: 1 },
        },
      });
      if (!updated.count) throw new ConflictException('盘点已发生变化，请刷新后重试');
      await this.audit.record(
        {
          organizationId: session.organization.id,
          actorAccountId: session.account.id,
          type: 'hold.rfid.inventory.cancelled',
          outcome: 'SUCCESS',
          metadata: { sessionId },
        },
        transaction,
      );
    });
    return this.getDetail(session.organization.id, sessionId);
  }

  private async getDetail(organizationId: string, sessionId: string) {
    const [inventorySession, grouped, reads, observations] = await this.prisma.$transaction([
      this.prisma.rfidInventorySession.findFirst({
        where: { id: sessionId, organizationId },
        include: sessionListInclude,
      }),
      this.prisma.rfidInventoryObservation.groupBy({
        by: ['matchStatus'],
        orderBy: { matchStatus: 'asc' },
        where: { sessionId, session: { organizationId } },
        _count: { _all: true },
      }),
      this.prisma.rfidInventoryObservation.aggregate({
        where: { sessionId, session: { organizationId } },
        _sum: { readCount: true },
      }),
      this.prisma.rfidInventoryObservation.findMany({
        where: { sessionId, session: { organizationId } },
        include: observationInclude,
        orderBy: { lastSeenAt: 'desc' },
        take: 100,
      }),
    ]);
    if (!inventorySession) throw new NotFoundException('RFID 盘点会话不存在');
    const counts = Object.fromEntries(
      (
        grouped as Array<{
          matchStatus: RfidInventoryMatchStatus;
          _count: { _all: number };
        }>
      ).map((item) => [item.matchStatus, item._count._all]),
    );
    const expectedQuantity = inventorySession._count.expectedUnits;
    const matchedExpected = counts[RfidInventoryMatchStatus.MATCHED_EXPECTED] ?? 0;
    return {
      ...toSessionListItem(inventorySession),
      summary: {
        expectedQuantity,
        observedQuantity: inventorySession._count.observations,
        totalReads: reads._sum.readCount ?? 0,
        matchedExpected,
        matchedUnexpected: counts[RfidInventoryMatchStatus.MATCHED_UNEXPECTED] ?? 0,
        unboundQuantity: counts[RfidInventoryMatchStatus.UNBOUND] ?? 0,
        unknownQuantity: counts[RfidInventoryMatchStatus.UNKNOWN] ?? 0,
        missingQuantity: Math.max(0, expectedQuantity - matchedExpected),
      },
      observations: observations.map(toObservation),
    };
  }
}

async function resolveFacility(
  transaction: Prisma.TransactionClient,
  session: CurrentSession,
  facilityId?: string,
) {
  const facility = facilityId
    ? await transaction.facility.findFirst({
        where: {
          id: facilityId,
          organizationId: session.organization.id,
          status: FacilityStatus.ACTIVE,
        },
      })
    : await transaction.facility.findFirst({
        where: { organizationId: session.organization.id, status: FacilityStatus.ACTIVE },
        orderBy: [{ isDefault: 'desc' }, { createdAt: 'asc' }],
      });
  if (facility) return facility;
  if (facilityId) throw new NotFoundException('场馆不存在或已停用');
  return transaction.facility.create({
    data: {
      organizationId: session.organization.id,
      code: 'DEFAULT',
      name: session.organization.name,
      isDefault: true,
    },
  });
}

async function findSession(
  transaction: Prisma.TransactionClient,
  organizationId: string,
  sessionId: string,
) {
  const inventorySession = await transaction.rfidInventorySession.findFirst({
    where: { id: sessionId, organizationId },
  });
  if (!inventorySession) throw new NotFoundException('RFID 盘点会话不存在');
  return inventorySession;
}

async function findOpenSession(
  transaction: Prisma.TransactionClient,
  organizationId: string,
  sessionId: string,
) {
  const inventorySession = await findSession(transaction, organizationId, sessionId);
  if (inventorySession.status !== RfidInventorySessionStatus.OPEN) {
    throw new ConflictException('只有进行中的盘点可以继续接收标签');
  }
  return inventorySession;
}

function assertVersion(actual: number, expected: number): void {
  if (actual !== expected) throw new ConflictException('盘点已发生变化，请刷新后重试');
}

function toSessionListItem(
  session: Prisma.RfidInventorySessionGetPayload<{ include: typeof sessionListInclude }>,
) {
  return {
    id: session.id,
    name: session.name,
    status: session.status,
    targetPhysicalStatus: session.targetPhysicalStatus,
    version: session.version,
    facility: session.facility,
    expectedQuantity: session._count.expectedUnits,
    observedQuantity: session._count.observations,
    batchCount: session._count.readBatches,
    createdAt: session.createdAt.toISOString(),
    completedAt: session.completedAt?.toISOString() ?? null,
    cancelledAt: session.cancelledAt?.toISOString() ?? null,
  };
}

function toObservation(
  observation: Prisma.RfidInventoryObservationGetPayload<{ include: typeof observationInclude }>,
) {
  return {
    id: observation.id,
    epc: observation.epc,
    matchStatus: observation.matchStatus,
    readCount: observation.readCount,
    firstSeenAt: observation.firstSeenAt.toISOString(),
    lastSeenAt: observation.lastSeenAt.toISOString(),
    unit: observation.holdUnit
      ? {
          id: observation.holdUnit.id,
          assetCode: observation.holdUnit.assetCode,
          physicalStatus: observation.holdUnit.physicalStatus,
          facility: observation.holdUnit.currentFacility,
          specification: {
            productName: observation.holdUnit.holdVariant.holdModel.name,
            manufacturer: observation.holdUnit.holdVariant.holdModel.brand,
            color: observation.holdUnit.holdVariant.color,
          },
        }
      : null,
  };
}
