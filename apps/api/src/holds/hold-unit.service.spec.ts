import { ConflictException } from '@nestjs/common';
import {
  HoldStatus,
  HoldTrackingMode,
  HoldUnitOperationalStatus,
  HoldUnitPhysicalStatus,
  InventoryVerificationStatus,
  MembershipRole,
  RfidTagStatus,
  RfidTechnology,
} from '@prisma/client';
import { describe, expect, it, vi } from 'vitest';
import type { CurrentSession } from '../auth/session.service';
import type { AuditService } from '../common/audit.service';
import type { PrismaService } from '../database/prisma.service';
import { AccessControlService } from '../security/access-control.service';
import { HoldUnitService } from './hold-unit.service';

const currentSession: CurrentSession = {
  account: { id: 'account-1', email: 'owner@example.com' },
  membership: { id: 'membership-1', displayName: '测试人员' },
  organization: { id: 'org-1', name: '测试岩馆' },
  role: MembershipRole.L1_ADMIN,
  expiresAt: new Date(),
};

const inventory = {
  id: 'balance-1',
  variantId: 'variant-1',
  warehouseQuantity: 3,
  installedQuantity: 1,
  reservedQuantity: 0,
  maintenanceQuantity: 0,
  verificationStatus: InventoryVerificationStatus.VERIFIED,
  version: 1,
  createdAt: new Date(),
  updatedAt: new Date(),
};

const facility = {
  id: 'facility-1',
  organizationId: 'org-1',
  code: 'DEFAULT',
  name: '测试岩馆',
  status: 'ACTIVE',
  isDefault: true,
  createdAt: new Date(),
  updatedAt: new Date(),
};

function unit(id: string) {
  const now = new Date();
  return {
    id,
    assetCode: `HLD-${id}`,
    holdVariantId: 'variant-1',
    ownerOrganizationId: 'org-1',
    currentCustodianOrganizationId: 'org-1',
    currentFacilityId: 'facility-1',
    registrationBatchId: 'batch-1',
    physicalStatus: HoldUnitPhysicalStatus.WAREHOUSE,
    operationalStatus: HoldUnitOperationalStatus.ACTIVE,
    version: 0,
    registeredByAccountId: 'account-1',
    retiredAt: null,
    currentFacility: { id: facility.id, code: facility.code, name: facility.name },
    tagBindings: [],
    createdAt: now,
    updatedAt: now,
  };
}

function subject(transaction: Record<string, unknown>) {
  const prisma = {
    $transaction: vi.fn(async (callback) => callback(transaction)),
  } as unknown as PrismaService;
  const audit = { record: vi.fn().mockResolvedValue({}) } as unknown as AuditService;
  return new HoldUnitService(prisma, audit, new AccessControlService());
}

describe('HoldUnitService', () => {
  it('从现有数量中建立单体，不重复增加库存数量', async () => {
    const units = [unit('unit-1'), unit('unit-2')];
    const transaction = {
      $executeRaw: vi.fn().mockResolvedValue(1),
      holdUnitRegistrationBatch: {
        findUnique: vi.fn().mockResolvedValue(null),
        create: vi.fn().mockResolvedValue({ id: 'batch-1' }),
      },
      holdVariant: {
        findFirst: vi.fn().mockResolvedValue({
          id: 'variant-1',
          status: HoldStatus.ACTIVE,
          trackingMode: HoldTrackingMode.QUANTITY,
          inventory,
        }),
        update: vi.fn().mockResolvedValue({}),
      },
      facility: { findFirst: vi.fn().mockResolvedValue(facility) },
      holdUnit: {
        count: vi.fn().mockResolvedValueOnce(0).mockResolvedValueOnce(2),
        createMany: vi.fn().mockResolvedValue({ count: 2 }),
        findMany: vi.fn().mockResolvedValue(units),
      },
      holdUnitEvent: { createMany: vi.fn().mockResolvedValue({ count: 2 }) },
      auditEvent: { create: vi.fn().mockResolvedValue({}) },
    };
    const result = await subject(transaction).registerBatch(currentSession, 'variant-1', {
      requestKey: '11111111-1111-4111-8111-111111111111',
      quantity: 2,
      physicalStatus: HoldUnitPhysicalStatus.WAREHOUSE,
    });

    expect(result).toMatchObject({ createdCount: 2, trackingMode: HoldTrackingMode.HYBRID });
    expect(transaction.holdUnit.createMany).toHaveBeenCalledTimes(1);
    expect(transaction.holdVariant.update).toHaveBeenCalledWith({
      where: { id: 'variant-1' },
      data: { trackingMode: HoldTrackingMode.HYBRID },
    });
    expect(transaction).not.toHaveProperty('holdInventoryBalance');
  });

  it('拒绝将同一汇总库存重复建立为更多物理岩点', async () => {
    const transaction = {
      $executeRaw: vi.fn().mockResolvedValue(1),
      holdUnitRegistrationBatch: { findUnique: vi.fn().mockResolvedValue(null) },
      holdVariant: {
        findFirst: vi.fn().mockResolvedValue({
          id: 'variant-1',
          status: HoldStatus.ACTIVE,
          trackingMode: HoldTrackingMode.HYBRID,
          inventory,
        }),
      },
      holdUnit: { count: vi.fn().mockResolvedValue(2) },
    };

    await expect(
      subject(transaction).registerBatch(currentSession, 'variant-1', {
        requestKey: '22222222-2222-4222-8222-222222222222',
        quantity: 2,
        physicalStatus: HoldUnitPhysicalStatus.WAREHOUSE,
      }),
    ).rejects.toThrow('仅剩 1 颗未建立物理身份');
  });

  it('拒绝把已绑定其他岩点的 EPC 再次绑定', async () => {
    const target = unit('unit-1');
    const transaction = {
      $executeRaw: vi.fn().mockResolvedValue(1),
      holdUnitEvent: { findUnique: vi.fn().mockResolvedValue(null) },
      holdUnit: { findFirst: vi.fn().mockResolvedValue(target) },
      rfidTag: {
        findUnique: vi.fn().mockResolvedValue({
          id: 'tag-1',
          organizationId: 'org-1',
          epc: 'E2801190',
          tid: null,
          technology: RfidTechnology.UHF_EPC_GEN2,
          status: RfidTagStatus.ACTIVE,
          bindings: [{ holdUnitId: 'unit-2' }],
        }),
      },
    };

    await expect(
      subject(transaction).bindTag(currentSession, 'unit-1', {
        requestKey: '33333333-3333-4333-8333-333333333333',
        epc: 'E2801190',
      }),
    ).rejects.toBeInstanceOf(ConflictException);
  });
});
