import { ConflictException, ForbiddenException } from '@nestjs/common';
import {
  InventoryBucket,
  InventoryMovementType,
  InventoryVerificationStatus,
  MembershipRole,
  HoldStatus,
} from '@prisma/client';
import { describe, expect, it, vi } from 'vitest';
import type { CurrentSession } from '../auth/session.service';
import type { AuditService } from '../common/audit.service';
import type { PrismaService } from '../database/prisma.service';
import { AccessControlService } from '../security/access-control.service';
import { HoldInventoryService } from './hold-inventory.service';

const balance = {
  id: 'balance-1',
  variantId: 'variant-1',
  warehouseQuantity: 8,
  installedQuantity: 4,
  reservedQuantity: 0,
  maintenanceQuantity: 0,
  verificationStatus: InventoryVerificationStatus.VERIFIED,
  version: 2,
  createdAt: new Date(),
  updatedAt: new Date(),
};

function session(role: MembershipRole): CurrentSession {
  return {
    account: { id: 'account-1', email: 'owner@example.com' },
    membership: { id: 'membership-1', displayName: '测试人员' },
    organization: { id: 'org-1', name: '测试岩馆' },
    role,
    expiresAt: new Date(),
  };
}

function createSubject(updateCount = 1) {
  const movementCreate = vi.fn().mockResolvedValue({});
  const transaction = {
    $executeRaw: vi.fn().mockResolvedValue(1),
    holdVariant: {
      findFirst: vi.fn().mockResolvedValue({
        id: 'variant-1',
        inventory: balance,
        holdModel: { categoryId: 'category-1' },
      }),
    },
    holdInventoryBalance: {
      updateMany: vi.fn().mockResolvedValue({ count: updateCount }),
      findUniqueOrThrow: vi
        .fn()
        .mockResolvedValue({ ...balance, warehouseQuantity: 11, version: 3 }),
    },
    holdInventoryMovement: { create: movementCreate, findUnique: vi.fn().mockResolvedValue(null) },
    auditEvent: { create: vi.fn().mockResolvedValue({}) },
  };
  const prisma = {
    $transaction: vi.fn(async (callback) => callback(transaction)),
  } as unknown as PrismaService;
  const audit = { record: vi.fn().mockResolvedValue({}) } as unknown as AuditService;
  return {
    movementCreate,
    transaction,
    service: new HoldInventoryService(prisma, audit, new AccessControlService()),
  };
}

function createReversalSubject(reversed = false) {
  const movementCreate = vi.fn().mockResolvedValue({});
  const transaction = {
    $executeRaw: vi.fn().mockResolvedValue(1),
    holdInventoryMovement: {
      create: movementCreate,
      findFirst: vi.fn().mockResolvedValue({
        id: 'receipt-1',
        organizationId: 'org-1',
        variantId: 'variant-1',
        type: InventoryMovementType.RECEIPT,
        bucket: InventoryBucket.WAREHOUSE,
        quantityDelta: 3,
        reversedBy: reversed ? { id: 'reversal-1' } : null,
        variant: {
          status: HoldStatus.ACTIVE,
          inventory: balance,
          holdModel: {
            categoryId: 'category-1',
            category: { status: HoldStatus.ACTIVE },
          },
        },
      }),
    },
    auditEvent: { create: vi.fn().mockResolvedValue({}) },
    holdInventoryBalance: {
      updateMany: vi.fn().mockResolvedValue({ count: 1 }),
      findUniqueOrThrow: vi
        .fn()
        .mockResolvedValue({ ...balance, warehouseQuantity: 5, version: 3 }),
    },
  };
  const prisma = {
    $transaction: vi.fn(async (callback) => callback(transaction)),
  } as unknown as PrismaService;
  const audit = { record: vi.fn().mockResolvedValue({}) } as unknown as AuditService;
  return {
    movementCreate,
    service: new HoldInventoryService(prisma, audit, new AccessControlService()),
  };
}

describe('HoldInventoryService', () => {
  it('以余额版本和不可变流水完成正常入库', async () => {
    const { movementCreate, service } = createSubject();
    const result = await service.recordMovement(session(MembershipRole.L2_ADMIN), 'variant-1', {
      requestKey: '11111111-1111-4111-8111-111111111111',
      type: InventoryMovementType.RECEIPT,
      bucket: InventoryBucket.WAREHOUSE,
      quantityDelta: 3,
    });
    expect(result.warehouseQuantity).toBe(11);
    expect(movementCreate).toHaveBeenCalledWith({
      data: expect.objectContaining({ beforeQuantity: 8, afterQuantity: 11, quantityDelta: 3 }),
    });
  });

  it('同一请求重试时返回现有余额而不重复入库', async () => {
    const { movementCreate, service, transaction } = createSubject();
    transaction.holdInventoryMovement.findUnique.mockResolvedValue({
      organizationId: 'org-1',
      variantId: 'variant-1',
      requestFingerprint: JSON.stringify([
        'variant-1',
        InventoryMovementType.RECEIPT,
        InventoryBucket.WAREHOUSE,
        3,
        null,
      ]),
    });
    const result = await service.recordMovement(session(MembershipRole.L2_ADMIN), 'variant-1', {
      requestKey: '11111111-1111-4111-8111-111111111111',
      type: InventoryMovementType.RECEIPT,
      bucket: InventoryBucket.WAREHOUSE,
      quantityDelta: 3,
    });
    expect(result.warehouseQuantity).toBe(11);
    expect(movementCreate).not.toHaveBeenCalled();
  });

  it('为墙面模块原子完成仓库到已上墙的双向记账', async () => {
    const createMany = vi.fn().mockResolvedValue({ count: 2 });
    const transaction = {
      $executeRaw: vi.fn().mockResolvedValue(1),
      holdVariant: {
        findFirst: vi.fn().mockResolvedValue({
          id: 'variant-1',
          inventory: balance,
          holdModel: { categoryId: 'category-1' },
        }),
      },
      holdInventoryMovement: { findUnique: vi.fn().mockResolvedValue(null), createMany },
      holdInventoryBalance: {
        updateMany: vi.fn().mockResolvedValue({ count: 1 }),
        findUniqueOrThrow: vi.fn().mockResolvedValue({
          ...balance,
          warehouseQuantity: 7,
          installedQuantity: 5,
          version: 3,
        }),
      },
    };
    const prisma = {
      $transaction: vi.fn(async (callback) => callback(transaction)),
    } as unknown as PrismaService;
    const audit = { record: vi.fn().mockResolvedValue({}) } as unknown as AuditService;
    const service = new HoldInventoryService(prisma, audit, new AccessControlService());
    const result = await service.transfer(session(MembershipRole.L2_ADMIN), {
      variantId: 'variant-1',
      from: InventoryBucket.WAREHOUSE,
      to: InventoryBucket.INSTALLED,
      quantity: 1,
      requestKey: '66666666-6666-4666-8666-666666666666',
      referenceType: 'WALL_PLACEMENT',
      referenceId: 'placement-1',
    });
    expect(result).toMatchObject({ warehouseQuantity: 7, installedQuantity: 5 });
    expect(createMany).toHaveBeenCalledWith({
      data: expect.arrayContaining([
        expect.objectContaining({ bucket: InventoryBucket.WAREHOUSE, quantityDelta: -1 }),
        expect.objectContaining({ bucket: InventoryBucket.INSTALLED, quantityDelta: 1 }),
      ]),
    });
  });

  it('拒绝会产生负数的库存校准', async () => {
    const { service } = createSubject();
    await expect(
      service.recordMovement(session(MembershipRole.L1_ADMIN), 'variant-1', {
        requestKey: '22222222-2222-4222-8222-222222222222',
        type: InventoryMovementType.ADJUSTMENT,
        bucket: InventoryBucket.WAREHOUSE,
        targetQuantity: -1,
        expectedVersion: 2,
        note: '盘点差异',
      }),
    ).rejects.toBeInstanceOf(ConflictException);
  });

  it('在并发版本冲突时要求刷新重试', async () => {
    const { service } = createSubject(0);
    await expect(
      service.recordMovement(session(MembershipRole.L1_ADMIN), 'variant-1', {
        requestKey: '33333333-3333-4333-8333-333333333333',
        type: InventoryMovementType.ADJUSTMENT,
        bucket: InventoryBucket.INSTALLED,
        targetQuantity: 5,
        expectedVersion: 2,
        note: '补录上墙数量',
      }),
    ).rejects.toBeInstanceOf(ConflictException);
  });

  it('拒绝使用过期页面提交实际库存', async () => {
    const { service } = createSubject();
    await expect(
      service.recordMovement(session(MembershipRole.L1_ADMIN), 'variant-1', {
        requestKey: '44444444-4444-4444-8444-444444444444',
        type: InventoryMovementType.ADJUSTMENT,
        bucket: InventoryBucket.WAREHOUSE,
        targetQuantity: 7,
        expectedVersion: 1,
        note: '现场重新清点',
      }),
    ).rejects.toThrow('库存已经发生变化，请刷新后重新确认实际数量');
  });

  it('拒绝 L2 执行库存校准', async () => {
    const { service } = createSubject();
    await expect(
      service.recordMovement(session(MembershipRole.L2_ADMIN), 'variant-1', {
        requestKey: '55555555-5555-4555-8555-555555555555',
        type: InventoryMovementType.ADJUSTMENT,
        bucket: InventoryBucket.WAREHOUSE,
        targetQuantity: 9,
        expectedVersion: 2,
        note: '越权尝试',
      }),
    ).rejects.toBeInstanceOf(ForbiddenException);
  });

  it('通过关联反向流水撤销正常入库', async () => {
    const { movementCreate, service } = createReversalSubject();
    const result = await service.reverseReceipt(session(MembershipRole.L1_ADMIN), 'receipt-1', {
      reason: '录入数量错误',
    });
    expect(result.warehouseQuantity).toBe(5);
    expect(movementCreate).toHaveBeenCalledWith({
      data: expect.objectContaining({
        type: InventoryMovementType.REVERSAL,
        quantityDelta: -3,
        reversalOfMovementId: 'receipt-1',
      }),
    });
  });

  it('拒绝重复撤销同一笔入库', async () => {
    const { service } = createReversalSubject(true);
    await expect(
      service.reverseReceipt(session(MembershipRole.L1_ADMIN), 'receipt-1', {
        reason: '再次撤销',
      }),
    ).rejects.toBeInstanceOf(ConflictException);
  });
});
