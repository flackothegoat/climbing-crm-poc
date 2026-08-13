import {
  MembershipRole,
  PlacementAnchorRole,
  RouteStatus,
  RouteVersionStatus,
} from '@prisma/client';
import { describe, expect, it, vi } from 'vitest';
import type { CurrentSession } from '../auth/session.service';
import type { AuditService } from '../common/audit.service';
import type { PrismaService } from '../database/prisma.service';
import { AccessControlService } from '../security/access-control.service';
import { RouteSettingService } from './route-setting.service';
import type { SaveRouteSettingPlanInput } from './wall-route.dto';

const session: CurrentSession = {
  account: { id: 'owner-1', email: 'owner@example.com' },
  membership: { id: 'membership-1', displayName: '老板' },
  organization: { id: 'org-1', name: '测试岩馆' },
  role: MembershipRole.L1_ADMIN,
  expiresAt: new Date(),
};

const input: SaveRouteSettingPlanInput = {
  schemaVersion: 1,
  settingJobId: 'job-1',
  revision: 0,
  wall: { code: 'W06' },
  routes: [{ id: 'route-green', name: '青苔', color: 'green', grade: 'V2' }],
  placements: [
    {
      id: 'client-placement-1',
      assetId: 'test-green',
      routeId: 'route-green',
      holeId: 'W06-C05-R01',
      role: 'START',
      rotationDegrees: 0,
    },
  ],
  updatedAt: '2026-08-10T00:00:00.000Z',
};

describe('RouteSettingService 几何版本与多孔锚点兼容写入', () => {
  it('保存单墙草稿时同步线路墙段关系和主锚点，但不写库存', async () => {
    const transaction = {
      $executeRaw: vi.fn().mockResolvedValue(1),
      wallSegment: {
        findFirst: vi.fn().mockResolvedValue({ id: 'wall-1', routePlanRevision: 0 }),
        updateMany: vi.fn().mockResolvedValue({ count: 1 }),
      },
      wallGeometryVersion: {
        findFirst: vi.fn().mockResolvedValue({ id: 'geometry-1', versionNumber: 1 }),
      },
      wallHole: {
        findMany: vi.fn().mockResolvedValue([{ id: 'hole-1', code: 'W06-C05-R01' }]),
      },
      route: {
        findUnique: vi.fn().mockResolvedValue({
          id: 'route-1',
          dataSource: 'DUMMY',
        }),
        update: vi.fn().mockResolvedValue({ id: 'route-1' }),
      },
      routeVersion: {
        findFirst: vi.fn().mockResolvedValue({
          id: 'version-1',
          dataSource: 'DUMMY',
          wallSegments: [{ wallSegmentId: 'wall-1' }],
        }),
        update: vi.fn().mockResolvedValue({}),
      },
      routeVersionWallSegment: {
        findMany: vi.fn().mockResolvedValue([]),
        upsert: vi.fn().mockResolvedValue({}),
      },
      routeHoldPlacement: {
        deleteMany: vi.fn().mockResolvedValue({ count: 0 }),
        create: vi.fn().mockResolvedValue({ id: 'client-placement-1' }),
        findMany: vi.fn().mockResolvedValue([]),
      },
      routeHoldPlacementAnchor: {
        deleteMany: vi.fn().mockResolvedValue({ count: 0 }),
        create: vi.fn().mockResolvedValue({}),
      },
      holdVariant: { count: vi.fn().mockResolvedValue(0) },
      wallSettingJob: {
        findFirst: vi.fn().mockResolvedValue({
          id: 'job-1',
          name: 'W06 定线任务',
          status: 'DRAFT',
        }),
      },
    };
    const prisma = {
      $transaction: vi.fn(async (callback) => callback(transaction)),
    } as unknown as PrismaService;
    const audit = { record: vi.fn().mockResolvedValue({}) } as unknown as AuditService;
    const service = new RouteSettingService(prisma, audit, new AccessControlService());
    vi.spyOn(service, 'getPlan').mockResolvedValue({ persisted: true } as never);

    await service.savePlan(session, 'W06', input);

    expect(transaction.wallHole.findMany).toHaveBeenCalledWith({
      where: {
        organizationId: 'org-1',
        wallSegmentId: 'wall-1',
        geometryVersionId: 'geometry-1',
        code: { in: ['W06-C05-R01'] },
      },
      select: { id: true, code: true },
    });
    expect(transaction.routeVersionWallSegment.upsert).toHaveBeenCalledWith(
      expect.objectContaining({
        create: expect.objectContaining({
          wallSegmentId: 'wall-1',
          geometryVersionId: 'geometry-1',
        }),
      }),
    );
    expect(transaction.routeHoldPlacementAnchor.create).toHaveBeenCalledWith({
      data: {
        organizationId: 'org-1',
        placementId: 'client-placement-1',
        wallHoleId: 'hole-1',
        role: PlacementAnchorRole.PRIMARY,
        ordinal: 0,
      },
    });
    expect(transaction).not.toHaveProperty('holdInventoryMovement');
  });

  it('从计划移除未安装草稿时退役版本而不删除历史', async () => {
    const transaction = {
      $executeRaw: vi.fn().mockResolvedValue(1),
      wallSegment: {
        findFirst: vi.fn().mockResolvedValue({ id: 'wall-1', routePlanRevision: 3 }),
        updateMany: vi.fn().mockResolvedValue({ count: 1 }),
      },
      wallGeometryVersion: {
        findFirst: vi.fn().mockResolvedValue({ id: 'geometry-1', versionNumber: 1 }),
      },
      wallHole: { findMany: vi.fn().mockResolvedValue([]) },
      holdVariant: { count: vi.fn().mockResolvedValue(0) },
      wallSettingJob: {
        findFirst: vi.fn().mockResolvedValue({
          id: 'job-1',
          name: 'W06 定线任务',
          status: 'DRAFT',
        }),
      },
      routeVersionWallSegment: {
        findMany: vi.fn().mockResolvedValue([
          {
            routeVersion: {
              id: 'version-1',
              routeId: 'route-1',
              route: { code: 'route-green' },
              wallSegments: [{ wallSegmentId: 'wall-1' }],
              installations: [],
            },
          },
        ]),
      },
      routeVersion: {
        update: vi.fn().mockResolvedValue({}),
        count: vi.fn().mockResolvedValue(0),
      },
      route: { update: vi.fn().mockResolvedValue({}) },
    };
    const prisma = {
      $transaction: vi.fn(async (callback) => callback(transaction)),
    } as unknown as PrismaService;
    const audit = { record: vi.fn().mockResolvedValue({}) } as unknown as AuditService;
    const service = new RouteSettingService(prisma, audit, new AccessControlService());
    vi.spyOn(service, 'getPlan').mockResolvedValue({ persisted: true } as never);

    await service.savePlan(session, 'W06', {
      ...input,
      revision: 3,
      routes: [],
      placements: [],
    });

    expect(transaction.routeVersion.update).toHaveBeenCalledWith({
      where: { id: 'version-1' },
      data: { status: RouteVersionStatus.RETIRED },
    });
    expect(transaction.route.update).toHaveBeenCalledWith({
      where: { id: 'route-1' },
      data: { status: RouteStatus.INACTIVE },
    });
    expect(transaction).not.toHaveProperty('routeHoldPlacement');
  });
});
