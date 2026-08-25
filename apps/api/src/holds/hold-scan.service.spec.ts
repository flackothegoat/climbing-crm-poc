import {
  ClimbingColor,
  HoldAssetKind,
  HoldAssetStatus,
  HoldGripType,
  HoldMountingType,
  HoldScanMode,
  HoldScanStatus,
  HoldSizeClass,
  MembershipRole,
} from '@prisma/client';
import { describe, expect, it, vi } from 'vitest';
import type { CurrentSession } from '../auth/session.service';
import type { AuditService } from '../common/audit.service';
import type { PrismaService } from '../database/prisma.service';
import { AccessControlService } from '../security/access-control.service';
import type { HoldAssetService } from './hold-asset.service';
import type { HoldInitializationService } from './hold-initialization.service';
import { HoldScanService } from './hold-scan.service';
import type { HoldSpecificationWriter } from './hold-specification.writer';

const session: CurrentSession = {
  account: { id: 'employee-1', email: 'employee@example.com' },
  membership: { id: 'membership-1', displayName: '员工' },
  organization: { id: 'org-1', name: '测试岩馆' },
  role: MembershipRole.L2_ADMIN,
  expiresAt: new Date(),
};

function createSubject() {
  const transaction = {
    $executeRaw: vi.fn().mockResolvedValue(1),
    holdVariant: { findFirst: vi.fn().mockResolvedValue({ id: 'variant-2' }) },
    holdScan: {
      findFirst: vi.fn().mockResolvedValue({
        id: 'scan-1',
        mode: HoldScanMode.CREATE_SPECIFICATION,
        specificationId: null,
        initializationBatchId: 'batch-1',
        category: { id: 'category-1', gripType: HoldGripType.JUG },
        assets: [
          {
            kind: HoldAssetKind.MODEL_SOURCE,
            status: HoldAssetStatus.READY,
            checksumSha256: 'model-checksum',
          },
        ],
      }),
      update: vi.fn().mockResolvedValue({}),
    },
    holdAsset: {
      count: vi.fn().mockResolvedValue(0),
      updateMany: vi.fn().mockResolvedValue({ count: 1 }),
    },
  };
  const prisma = {
    $transaction: vi.fn(async (callback) => callback(transaction)),
  } as unknown as PrismaService;
  const writer = {
    create: vi.fn().mockResolvedValue({ model: { id: 'model-1' }, variant: { id: 'variant-1' } }),
  } as unknown as HoldSpecificationWriter;
  const initialization = {
    addEntry: vi.fn().mockResolvedValue({}),
  } as unknown as HoldInitializationService;
  const audit = { record: vi.fn().mockResolvedValue({}) } as unknown as AuditService;
  const assets = {} as HoldAssetService;
  return {
    initialization,
    transaction,
    writer,
    service: new HoldScanService(
      prisma,
      audit,
      new AccessControlService(),
      assets,
      initialization,
      writer,
    ),
  };
}

describe('HoldScanService', () => {
  it('在同一事务中创建扫描规格、初始化库存并关联资产', async () => {
    const { initialization, service, transaction, writer } = createSubject();
    const result = await service.finalize(session, 'scan-1', {
      specification: {
        productName: '扫描岩点',
        manufacturer: '未知生产商',
        sizeClass: HoldSizeClass.M,
        mountingType: HoldMountingType.UNKNOWN,
        color: ClimbingColor.GREEN,
      },
      inventory: { warehouseQuantity: 3, installedQuantity: 2 },
    });
    expect(result).toEqual({ productModelId: 'model-1', specificationId: 'variant-1' });
    expect(writer.create).toHaveBeenCalledWith(
      transaction,
      session,
      expect.anything(),
      expect.anything(),
      { fingerprint: 'model-checksum', productKey: '未知生产商|扫描岩点|m|unknown|||' },
    );
    expect(initialization.addEntry).toHaveBeenCalledWith(
      transaction,
      session,
      'batch-1',
      'variant-1',
      { warehouseQuantity: 3, installedQuantity: 2 },
      'scan-1',
    );
    expect(transaction.holdScan.update).toHaveBeenCalledWith({
      where: { id: 'scan-1' },
      data: expect.objectContaining({
        specificationId: 'variant-1',
        status: HoldScanStatus.COMPLETED,
      }),
    });
  });

  it('把三维模型关联到已有档案而不创建新库存档案', async () => {
    const { initialization, service, transaction, writer } = createSubject();
    transaction.holdScan.findFirst.mockResolvedValue({
      id: 'scan-2',
      mode: HoldScanMode.ENRICH_SPECIFICATION,
      specificationId: 'variant-2',
      initializationBatchId: null,
      category: { id: 'category-1', gripType: HoldGripType.JUG },
      assets: [
        {
          kind: HoldAssetKind.MODEL_SOURCE,
          status: HoldAssetStatus.READY,
          checksumSha256: 'new-model',
        },
      ],
    });
    await service.completeAttachment(session, 'scan-2');
    expect(writer.create).not.toHaveBeenCalled();
    expect(initialization.addEntry).not.toHaveBeenCalled();
    expect(transaction.holdAsset.updateMany).toHaveBeenCalledWith({
      where: { scanId: 'scan-2' },
      data: { specificationId: 'variant-2' },
    });
  });
});
