import {
  InventoryBucket,
  MembershipRole,
  RouteVersionStatus,
  WallSettingJobStatus,
  WallSettingReservationStatus,
} from '@prisma/client';
import { describe, expect, it, vi } from 'vitest';
import type { CurrentSession } from '../auth/session.service';
import type { AuditService } from '../common/audit.service';
import type { PrismaService } from '../database/prisma.service';
import type { HoldInventoryService } from '../holds/hold-inventory.service';
import { AccessControlService } from '../security/access-control.service';
import { WallSettingJobService } from './wall-setting-job.service';

const session: CurrentSession = {
  account: { id: 'owner-1', email: 'owner@example.com' },
  membership: { id: 'membership-1', displayName: '老板' },
  organization: { id: 'org-1', name: '测试岩馆' },
  role: MembershipRole.L1_ADMIN,
  expiresAt: new Date(),
};

const requestKey = '75fc093c-974b-4b14-9d79-cd024be97319';

function makeJob(status: WallSettingJobStatus) {
  return {
    id: 'job-1',
    code: 'SETTING-W06-TEST',
    name: 'W06 定线任务',
    status,
    startedAt: new Date('2026-08-12T01:00:00.000Z'),
    completedAt: null,
    lockRequestKey: null,
    cancelRequestKey: null,
    completeRequestKey: null,
    segments: [{ id: 'job-segment-1' }],
    reservations: [],
    routeVersions: [
      {
        id: 'version-1',
        routeId: 'route-1',
        status: RouteVersionStatus.DRAFT,
        route: { id: 'route-1' },
        placements: [
          {
            id: 'placement-1',
            holdVariantId: 'variant-1',
            anchors: [
              {
                wallHoleId: 'hole-1',
                role: 'PRIMARY',
                ordinal: 0,
              },
            ],
          },
        ],
      },
      {
        id: 'version-retired',
        routeId: 'route-retired',
        status: RouteVersionStatus.RETIRED,
        route: { id: 'route-retired' },
        placements: [
          {
            id: 'placement-retired',
            holdVariantId: 'variant-retired',
            anchors: [],
          },
        ],
      },
    ],
  };
}

function makeService(transaction: Record<string, unknown>) {
  const prisma = {
    $transaction: vi.fn(async (callback) => callback(transaction)),
  } as unknown as PrismaService;
  const inventory = {
    transferInTransaction: vi.fn().mockResolvedValue({}),
  } as unknown as HoldInventoryService;
  const audit = { record: vi.fn().mockResolvedValue({}) } as unknown as AuditService;
  return {
    service: new WallSettingJobService(prisma, inventory, audit, new AccessControlService()),
    inventory,
  };
}

describe('WallSettingJobService 库存生命周期', () => {
  it('锁定时只按有效草稿位置从仓库转入预留', async () => {
    const job = makeJob(WallSettingJobStatus.DRAFT);
    const updated = {
      ...job,
      status: WallSettingJobStatus.READY,
      lockRequestKey: requestKey,
      reservations: [
        {
          id: 'reservation-1',
          holdVariantId: 'variant-1',
          quantity: 1,
          status: WallSettingReservationStatus.ACTIVE,
        },
      ],
    };
    const transaction = {
      $executeRaw: vi.fn().mockResolvedValue(1),
      wallSettingJob: {
        findFirst: vi.fn().mockResolvedValue(job),
        update: vi.fn().mockResolvedValue(updated),
      },
      wallSettingJobHoldReservation: { create: vi.fn().mockResolvedValue({}) },
      route: { updateMany: vi.fn().mockResolvedValue({ count: 1 }) },
    };
    const { service, inventory } = makeService(transaction);

    const result = await service.lock(session, 'job-1', { requestKey });

    expect(inventory.transferInTransaction).toHaveBeenCalledTimes(1);
    expect(inventory.transferInTransaction).toHaveBeenCalledWith(
      transaction,
      session,
      expect.objectContaining({
        variantId: 'variant-1',
        from: InventoryBucket.WAREHOUSE,
        to: InventoryBucket.RESERVED,
        quantity: 1,
      }),
    );
    expect(transaction.route.updateMany).toHaveBeenCalledWith({
      where: { id: { in: ['route-1'] } },
      data: { status: 'READY_FOR_INSTALL' },
    });
    expect(result.status).toBe(WallSettingJobStatus.READY);
  });

  it('取消已锁定任务时释放预留并退役草稿', async () => {
    const job = {
      ...makeJob(WallSettingJobStatus.READY),
      reservations: [
        {
          id: 'reservation-1',
          holdVariantId: 'variant-1',
          quantity: 1,
          status: WallSettingReservationStatus.ACTIVE,
        },
      ],
    };
    const updated = {
      ...job,
      status: WallSettingJobStatus.CANCELLED,
      cancelRequestKey: requestKey,
      reservations: [
        {
          ...job.reservations[0],
          status: WallSettingReservationStatus.RELEASED,
        },
      ],
    };
    const transaction = {
      $executeRaw: vi.fn().mockResolvedValue(1),
      wallSettingJob: {
        findFirst: vi.fn().mockResolvedValue(job),
        update: vi.fn().mockResolvedValue(updated),
      },
      wallSettingJobHoldReservation: { update: vi.fn().mockResolvedValue({}) },
      wallSettingJobSegment: { updateMany: vi.fn().mockResolvedValue({ count: 1 }) },
      routeVersion: {
        updateMany: vi.fn().mockResolvedValue({ count: 1 }),
        count: vi.fn().mockResolvedValue(0),
      },
      route: { update: vi.fn().mockResolvedValue({}) },
    };
    const { service, inventory } = makeService(transaction);

    await service.cancel(session, 'job-1', { requestKey });

    expect(inventory.transferInTransaction).toHaveBeenCalledWith(
      transaction,
      session,
      expect.objectContaining({
        variantId: 'variant-1',
        from: InventoryBucket.RESERVED,
        to: InventoryBucket.WAREHOUSE,
        quantity: 1,
      }),
    );
    expect(transaction.wallSettingJobHoldReservation.update).toHaveBeenCalledWith({
      where: { id: 'reservation-1' },
      data: expect.objectContaining({ status: WallSettingReservationStatus.RELEASED }),
    });
  });

  it('完成任务时只为有效位置建安装记录并将预留转为已安装', async () => {
    const job = {
      ...makeJob(WallSettingJobStatus.READY),
      reservations: [
        {
          id: 'reservation-1',
          holdVariantId: 'variant-1',
          quantity: 1,
          status: WallSettingReservationStatus.ACTIVE,
        },
      ],
    };
    const updated = {
      ...job,
      status: WallSettingJobStatus.COMPLETED,
      completedAt: new Date('2026-08-12T02:00:00.000Z'),
      completeRequestKey: requestKey,
      reservations: [
        {
          ...job.reservations[0],
          status: WallSettingReservationStatus.CONSUMED,
        },
      ],
    };
    const transaction = {
      $executeRaw: vi.fn().mockResolvedValue(1),
      wallSettingJob: {
        findFirst: vi.fn().mockResolvedValue(job),
        update: vi.fn().mockResolvedValue(updated),
      },
      holdInstallation: { create: vi.fn().mockResolvedValue({}) },
      wallSettingJobHoldReservation: { update: vi.fn().mockResolvedValue({}) },
      wallSettingJobSegment: { updateMany: vi.fn().mockResolvedValue({ count: 1 }) },
      routeVersion: { updateMany: vi.fn().mockResolvedValue({ count: 1 }) },
      route: { updateMany: vi.fn().mockResolvedValue({ count: 1 }) },
    };
    const { service, inventory } = makeService(transaction);

    await service.complete(session, 'job-1', {
      requestKey,
      installedAt: '2026-08-12T10:00:00+08:00',
    });

    expect(transaction.holdInstallation.create).toHaveBeenCalledTimes(1);
    expect(transaction.holdInstallation.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        holdVariantId: 'variant-1',
        routeVersionId: 'version-1',
        routeHoldPlacementId: 'placement-1',
        settingJobId: 'job-1',
      }),
    });
    expect(inventory.transferInTransaction).toHaveBeenCalledWith(
      transaction,
      session,
      expect.objectContaining({
        variantId: 'variant-1',
        from: InventoryBucket.RESERVED,
        to: InventoryBucket.INSTALLED,
        quantity: 1,
      }),
    );
    expect(transaction.route.updateMany).toHaveBeenCalledWith({
      where: { id: { in: ['route-1'] } },
      data: { status: 'PUBLISHED' },
    });
  });
});
