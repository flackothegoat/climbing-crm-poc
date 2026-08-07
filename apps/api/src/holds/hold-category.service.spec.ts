import { ConflictException } from '@nestjs/common';
import { HoldGripType, HoldStatus, MembershipRole } from '@prisma/client';
import { describe, expect, it, vi } from 'vitest';
import type { CurrentSession } from '../auth/session.service';
import type { AuditService } from '../common/audit.service';
import type { PrismaService } from '../database/prisma.service';
import { AccessControlService } from '../security/access-control.service';
import { HoldCategoryService } from './hold-category.service';

const session: CurrentSession = {
  account: { id: 'owner-1', email: 'owner@example.com' },
  membership: { id: 'membership-1', displayName: '老板' },
  organization: { id: 'org-1', name: '测试岩馆' },
  role: MembershipRole.L1_ADMIN,
  expiresAt: new Date(),
};

function createService(prisma: PrismaService) {
  const audit = { record: vi.fn().mockResolvedValue({}) } as unknown as AuditService;
  return new HoldCategoryService(prisma, audit, new AccessControlService());
}

describe('HoldCategoryService 编号与安全删除', () => {
  it('一次补齐缺少的系统用途分类，不覆盖已有分类', async () => {
    const createMany = vi.fn().mockResolvedValue({ count: 7 });
    const transaction = {
      $executeRaw: vi.fn().mockResolvedValue(1),
      holdCategory: { createMany },
    };
    const prisma = {
      $transaction: vi.fn(async (callback) => callback(transaction)),
    } as unknown as PrismaService;
    await createService(prisma).ensureDefaults(session);
    expect(createMany).toHaveBeenCalledWith({
      data: expect.arrayContaining([expect.objectContaining({ gripType: HoldGripType.CRIMP })]),
      skipDuplicates: true,
    });
  });

  it('停用分类继续占用编号，并返回可执行指引', async () => {
    const transaction = {
      $executeRaw: vi.fn().mockResolvedValue(1),
      holdCategory: {
        findFirst: vi.fn().mockResolvedValue({
          code: '002',
          gripType: HoldGripType.CRIMP,
          status: HoldStatus.ARCHIVED,
        }),
      },
    };
    const prisma = {
      $transaction: vi.fn(async (callback) => callback(transaction)),
    } as unknown as PrismaService;
    await expect(
      createService(prisma).create(session, {
        code: '002',
        name: '小扣点',
        gripType: HoldGripType.CRIMP,
      }),
    ).rejects.toThrow('永久删除未使用档案后编号才会释放');
  });

  it('永久删除未使用分类时一并清理空规格并删除分类记录', async () => {
    const deleteCategory = vi.fn().mockResolvedValue({});
    const transaction = {
      $executeRaw: vi.fn().mockResolvedValue(1),
      holdInventoryBalance: { deleteMany: vi.fn().mockResolvedValue({ count: 0 }) },
      holdVariant: { deleteMany: vi.fn().mockResolvedValue({ count: 0 }) },
      holdModel: { deleteMany: vi.fn().mockResolvedValue({ count: 0 }) },
      holdCategory: {
        findFirst: vi.fn().mockResolvedValue({
          id: 'category-1',
          status: HoldStatus.ACTIVE,
          _count: { scans: 0 },
          models: [],
        }),
        delete: deleteCategory,
      },
    };
    const prisma = {
      $transaction: vi.fn(async (callback) => callback(transaction)),
    } as unknown as PrismaService;
    await createService(prisma).deleteUnused(session, 'category-1');
    expect(deleteCategory).toHaveBeenCalledWith({ where: { id: 'category-1' } });
  });

  it('存在历史流水时拒绝永久删除分类', async () => {
    const transaction = {
      $executeRaw: vi.fn().mockResolvedValue(1),
      holdCategory: {
        findFirst: vi.fn().mockResolvedValue({
          id: 'category-1',
          _count: { scans: 0 },
          models: [
            {
              _count: { variants: 1 },
              variants: [{ inventory: null, _count: { movements: 1 } }],
            },
          ],
        }),
      },
    };
    const prisma = {
      $transaction: vi.fn(async (callback) => callback(transaction)),
    } as unknown as PrismaService;
    await expect(createService(prisma).deleteUnused(session, 'category-1')).rejects.toBeInstanceOf(
      ConflictException,
    );
  });

  it('存在扫描历史时保留分类及其编号', async () => {
    const transaction = {
      $executeRaw: vi.fn().mockResolvedValue(1),
      holdCategory: {
        findFirst: vi.fn().mockResolvedValue({
          id: 'category-1',
          _count: { scans: 1 },
          models: [],
        }),
      },
    };
    const prisma = {
      $transaction: vi.fn(async (callback) => callback(transaction)),
    } as unknown as PrismaService;
    await expect(createService(prisma).deleteUnused(session, 'category-1')).rejects.toBeInstanceOf(
      ConflictException,
    );
  });
});
