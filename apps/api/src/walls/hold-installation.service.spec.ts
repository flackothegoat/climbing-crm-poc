import {
  HoldInstallationSource,
  HoldInstallationStatus,
  MembershipRole,
  PlacementAnchorRole,
} from '@prisma/client';
import { describe, expect, it, vi } from 'vitest';
import type { CurrentSession } from '../auth/session.service';
import type { AuditService } from '../common/audit.service';
import type { PrismaService } from '../database/prisma.service';
import type { HoldInventoryService } from '../holds/hold-inventory.service';
import { AccessControlService } from '../security/access-control.service';
import { HoldInstallationService } from './hold-installation.service';

const session: CurrentSession = {
  account: { id: 'owner-1', email: 'owner@example.com' },
  membership: { id: 'membership-1', displayName: '老板' },
  organization: { id: 'org-1', name: '测试岩馆' },
  role: MembershipRole.L1_ADMIN,
  expiresAt: new Date(),
};

describe('HoldInstallationService', () => {
  it('在同一事务中创建安装、锚点和库存转移', async () => {
    const installedAt = new Date('2026-08-11T04:00:00.000Z');
    const transaction = {
      $executeRaw: vi.fn().mockResolvedValue(1),
      holdInstallation: {
        findUnique: vi.fn().mockResolvedValue(null),
        create: vi.fn().mockResolvedValue({
          id: 'installation-1',
          holdVariantId: 'variant-1',
          routeVersionId: 'version-1',
          routeHoldPlacementId: 'placement-1',
          settingJobId: null,
          status: HoldInstallationStatus.INSTALLED,
          source: HoldInstallationSource.SETTING_JOB,
          installedAt,
          removedAt: null,
          note: null,
          anchors: [
            {
              wallHoleId: 'hole-1',
              role: PlacementAnchorRole.PRIMARY,
              ordinal: 0,
              releasedAt: null,
            },
          ],
        }),
      },
      routeHoldPlacement: {
        findFirst: vi.fn().mockResolvedValue({
          id: 'placement-1',
          routeVersionId: 'version-1',
          holdVariantId: 'variant-1',
          anchors: [{ wallHoleId: 'hole-1', role: PlacementAnchorRole.PRIMARY, ordinal: 0 }],
        }),
      },
    };
    const prisma = {
      $transaction: vi.fn(async (callback) => callback(transaction)),
    } as unknown as PrismaService;
    const inventory = {
      transferInTransaction: vi.fn().mockResolvedValue({ installedQuantity: 1 }),
    } as unknown as HoldInventoryService;
    const audit = { record: vi.fn().mockResolvedValue({}) } as unknown as AuditService;
    const service = new HoldInstallationService(
      prisma,
      inventory,
      audit,
      new AccessControlService(),
    );

    await service.install(session, {
      requestKey: '75fc093c-974b-4b14-9d79-cd024be97319',
      routeHoldPlacementId: 'placement-1',
      source: HoldInstallationSource.SETTING_JOB,
    });

    expect(inventory.transferInTransaction).toHaveBeenCalledWith(
      transaction,
      session,
      expect.objectContaining({
        variantId: 'variant-1',
        from: 'WAREHOUSE',
        to: 'INSTALLED',
        referenceId: 'installation-1',
      }),
    );
    expect(audit.record).toHaveBeenCalledWith(
      expect.objectContaining({ type: 'hold.installation.installed' }),
      transaction,
    );
  });
});
