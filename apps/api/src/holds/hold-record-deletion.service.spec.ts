import { ConflictException, ForbiddenException } from '@nestjs/common';
import {
  HoldAssetKind,
  HoldStatus,
  InventoryBucket,
  InventoryMovementType,
  InventoryVerificationStatus,
  MembershipRole,
} from '@prisma/client';
import { describe, expect, it, vi } from 'vitest';
import type { CurrentSession } from '../auth/session.service';
import type { PrismaService } from '../database/prisma.service';
import { AccessControlService } from '../security/access-control.service';
import { HoldRecordDeletionService } from './hold-record-deletion.service';

const record = {
  id: 'variant-1',
  holdModelId: 'model-1',
  colorName: '黄色',
  colorHex: '#F1D94A',
  sku: 'YELLOW-1',
  status: HoldStatus.ACTIVE,
  colorKey: 'yellow-key',
  activeColorKey: 'yellow-key',
  deletedAt: null,
  deletedByAccountId: null,
  deletionReason: null,
  deletionSnapshot: null,
  createdAt: new Date(),
  updatedAt: new Date(),
  inventory: {
    id: 'balance-1',
    variantId: 'variant-1',
    warehouseQuantity: 5,
    installedQuantity: 4,
    reservedQuantity: 0,
    maintenanceQuantity: 1,
    verificationStatus: InventoryVerificationStatus.VERIFIED,
    version: 7,
    createdAt: new Date(),
    updatedAt: new Date(),
  },
  assets: [
    {
      id: 'asset-1',
      kind: HoldAssetKind.MODEL_3D,
      status: 'READY',
      originalFileName: 'hold.glb',
      sizeBytes: 512,
      checksumSha256: 'checksum-1',
    },
  ],
  holdModel: {
    id: 'model-1',
    organizationId: 'org-1',
    categoryId: 'category-1',
    code: 'HOLD-1',
    name: '三角形',
    brand: '测试品牌',
    gripType: 'JUG',
    style: '几何',
    sizeClass: 'M',
    widthMm: 120,
    heightMm: 100,
    depthMm: 60,
    mountingType: 'BOLT_ON',
    description: null,
    status: HoldStatus.ACTIVE,
    productKey: 'product-key',
    identitySource: 'SCAN',
    scanFingerprint: null,
    createdByAccountId: 'owner-1',
    createdAt: new Date(),
    updatedAt: new Date(),
    category: { id: 'category-1', name: '大把手' },
  },
};

function session(role: MembershipRole): CurrentSession {
  return {
    account: { id: 'owner-1', email: 'owner@example.com' },
    membership: { id: 'membership-1', displayName: '老板' },
    organization: { id: 'org-1', name: '测试岩馆' },
    role,
    expiresAt: new Date(),
  };
}

function createSubject(updateCount = 1) {
  const transaction = {
    $executeRaw: vi.fn().mockResolvedValue(1),
    holdInventoryBalance: { updateMany: vi.fn().mockResolvedValue({ count: updateCount }) },
    holdInventoryMovement: { createMany: vi.fn().mockResolvedValue({ count: 3 }) },
    holdScan: { updateMany: vi.fn().mockResolvedValue({ count: 1 }) },
    holdAsset: { updateMany: vi.fn().mockResolvedValue({ count: 1 }) },
    holdVariant: {
      findFirst: vi.fn().mockResolvedValue(record),
      update: vi.fn().mockResolvedValue({}),
    },
    auditEvent: { create: vi.fn().mockResolvedValue({}) },
  };
  const prisma = {
    $transaction: vi.fn(async (callback) => callback(transaction)),
  } as unknown as PrismaService;
  return {
    transaction,
    service: new HoldRecordDeletionService(prisma, new AccessControlService()),
  };
}

describe('HoldRecordDeletionService', () => {
  it('在一个事务中清零库存、写入流水并保留删除存根', async () => {
    const { service, transaction } = createSubject();
    await service.permanentlyDelete(session(MembershipRole.L1_ADMIN), 'variant-1', {
      expectedVersion: 7,
      reason: '现场重复建档',
      confirmationText: '删除',
    });

    expect(transaction.holdInventoryBalance.updateMany).toHaveBeenCalledWith({
      where: { id: 'balance-1', version: 7 },
      data: expect.objectContaining({ warehouseQuantity: 0, installedQuantity: 0 }),
    });
    expect(transaction.holdInventoryMovement.createMany).toHaveBeenCalledWith({
      data: expect.arrayContaining([
        expect.objectContaining({
          type: InventoryMovementType.RECORD_DELETION,
          bucket: InventoryBucket.WAREHOUSE,
          beforeQuantity: 5,
          afterQuantity: 0,
          quantityDelta: -5,
        }),
        expect.objectContaining({ bucket: InventoryBucket.INSTALLED, quantityDelta: -4 }),
        expect.objectContaining({ bucket: InventoryBucket.MAINTENANCE, quantityDelta: -1 }),
      ]),
    });
    expect(transaction.holdVariant.update).toHaveBeenCalledWith({
      where: { id: 'variant-1' },
      data: expect.objectContaining({
        deletedByAccountId: 'owner-1',
        activeColorKey: null,
        deletionSnapshot: expect.any(Object),
      }),
    });
  });

  it('拒绝过期页面提交的库存版本', async () => {
    const { service } = createSubject();
    await expect(
      service.permanentlyDelete(session(MembershipRole.L1_ADMIN), 'variant-1', {
        expectedVersion: 6,
        reason: '重复建档',
        confirmationText: '删除',
      }),
    ).rejects.toBeInstanceOf(ConflictException);
  });

  it('库存并发变化时回滚删除事务', async () => {
    const { service } = createSubject(0);
    await expect(
      service.permanentlyDelete(session(MembershipRole.L1_ADMIN), 'variant-1', {
        expectedVersion: 7,
        reason: '重复建档',
        confirmationText: '删除',
      }),
    ).rejects.toBeInstanceOf(ConflictException);
  });

  it('拒绝 L2 员工永久删除档案', async () => {
    const { service } = createSubject();
    await expect(
      service.permanentlyDelete(session(MembershipRole.L2_ADMIN), 'variant-1', {
        expectedVersion: 7,
        reason: '越权删除',
        confirmationText: '删除',
      }),
    ).rejects.toBeInstanceOf(ForbiddenException);
  });
});
