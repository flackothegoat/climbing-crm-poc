import { HoldStatus, InventoryVerificationStatus, MembershipRole } from '@prisma/client';
import { describe, expect, it, vi } from 'vitest';
import type { CurrentSession } from '../auth/session.service';
import type { AuditService } from '../common/audit.service';
import type { PrismaService } from '../database/prisma.service';
import { AccessControlService } from '../security/access-control.service';
import { HoldInitializationService } from './hold-initialization.service';

const session: CurrentSession = {
  account: { id: 'employee-1', email: 'employee@example.com' },
  membership: { id: 'membership-1', displayName: '员工' },
  organization: { id: 'org-1', name: '测试岩馆' },
  role: MembershipRole.L2_ADMIN,
  expiresAt: new Date(),
};

const balance = {
  id: 'balance-1',
  variantId: 'specification-1',
  warehouseQuantity: 1,
  installedQuantity: 2,
  reservedQuantity: 0,
  maintenanceQuantity: 0,
  verificationStatus: InventoryVerificationStatus.UNVERIFIED,
  version: 3,
  createdAt: new Date(),
  updatedAt: new Date(),
};

function createSubject() {
  const movementCreateMany = vi.fn().mockResolvedValue({ count: 2 });
  const transaction = {
    $executeRaw: vi.fn().mockResolvedValue(1),
    holdVariant: {
      findFirst: vi.fn().mockResolvedValue({ id: 'specification-1', status: HoldStatus.ACTIVE }),
    },
    holdInitializationBatch: {
      findFirst: vi.fn().mockResolvedValue({ _count: { entries: 0, scans: 0 } }),
    },
    holdInventoryBalance: {
      findUnique: vi.fn().mockResolvedValue(balance),
      updateMany: vi.fn().mockResolvedValue({ count: 1 }),
    },
    holdInitializationEntry: {
      create: vi.fn().mockResolvedValue({ id: 'entry-1' }),
    },
    holdInventoryMovement: { createMany: movementCreateMany },
  };
  const prisma = {
    $transaction: vi.fn(async (callback) => callback(transaction)),
  } as unknown as PrismaService;
  const audit = { record: vi.fn().mockResolvedValue({}) } as unknown as AuditService;
  return {
    movementCreateMany,
    service: new HoldInitializationService(prisma, audit, new AccessControlService()),
    transaction,
  };
}

describe('HoldInitializationService', () => {
  it('把观察实数写成余额，并用不可变流水记录差额', async () => {
    const { movementCreateMany, service, transaction } = createSubject();
    await service.initializeExisting(session, 'specification-1', {
      batchId: 'batch-1',
      warehouseQuantity: 4,
      installedQuantity: 3,
      note: '现场逐一核对',
    });
    expect(transaction.holdInventoryBalance.updateMany).toHaveBeenCalledWith({
      where: { id: 'balance-1', version: 3 },
      data: expect.objectContaining({ warehouseQuantity: 4, installedQuantity: 3 }),
    });
    expect(movementCreateMany).toHaveBeenCalledWith({
      data: expect.arrayContaining([
        expect.objectContaining({ beforeQuantity: 1, afterQuantity: 4, quantityDelta: 3 }),
        expect.objectContaining({ beforeQuantity: 2, afterQuantity: 3, quantityDelta: 1 }),
      ]),
    });
  });
});
