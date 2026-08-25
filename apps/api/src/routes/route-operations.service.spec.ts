import { ClimbingColor, MembershipRole } from '@prisma/client';
import { describe, expect, it, vi } from 'vitest';
import type { CurrentSession } from '../auth/session.service';
import type { AuditService } from '../common/audit.service';
import type { PrismaService } from '../database/prisma.service';
import { AccessControlService } from '../security/access-control.service';
import type { TokenService } from '../security/token.service';
import { RouteOperationsService } from './route-operations.service';

const session: CurrentSession = {
  account: { id: 'owner-1', email: 'owner@example.com' },
  membership: { id: 'membership-1', displayName: '定线负责人' },
  organization: { id: 'org-1', name: '测试岩馆' },
  role: MembershipRole.L1_ADMIN,
  expiresAt: new Date(),
};

describe('RouteOperationsService 第一阶段线路建档', () => {
  it('创建线路时只写墙段关系，不要求几何版本或岩点位置', async () => {
    const transaction = {
      $executeRaw: vi.fn().mockResolvedValue(1),
      wallSegment: {
        findMany: vi.fn().mockResolvedValue([
          { id: 'wall-segment-0001', areaId: 'area-1' },
          { id: 'wall-segment-0002', areaId: 'area-1' },
        ]),
      },
      wallSegmentAdjacency: {
        findMany: vi
          .fn()
          .mockResolvedValue([
            { segmentAId: 'wall-segment-0001', segmentBId: 'wall-segment-0002' },
          ]),
      },
      membership: { findFirst: vi.fn().mockResolvedValue({ id: 'membership-1' }) },
      route: {
        create: vi.fn().mockResolvedValue({ id: 'route-1', code: 'R-027' }),
      },
      routeVersion: {
        create: vi.fn().mockResolvedValue({ id: 'version-1' }),
      },
      routeVersionWallSegment: { createMany: vi.fn().mockResolvedValue({ count: 2 }) },
      auditEvent: { create: vi.fn().mockResolvedValue({}) },
    };
    const prisma = {
      $transaction: vi.fn(async (callback) => callback(transaction)),
    } as unknown as PrismaService;
    const audit = { record: vi.fn().mockResolvedValue({}) } as unknown as AuditService;
    const service = new RouteOperationsService(
      prisma,
      audit,
      new AccessControlService(),
      {} as TokenService,
    );
    vi.spyOn(service, 'get').mockResolvedValue({ id: 'route-1' } as never);

    await service.create(session, {
      code: 'R-027',
      name: '晨雾',
      description: null,
      color: ClimbingColor.GREEN,
      grade: 'V3',
      gradeSystem: 'V',
      styleTags: ['平衡'],
      setterMembershipId: 'membership-1',
      wallSegmentIds: ['wall-segment-0001', 'wall-segment-0002'],
      expectedRetireAt: null,
    });

    expect(transaction.routeVersionWallSegment.createMany).toHaveBeenCalledWith({
      data: [
        expect.objectContaining({
          wallSegmentId: 'wall-segment-0001',
          geometryVersionId: null,
          ordinal: 0,
        }),
        expect.objectContaining({
          wallSegmentId: 'wall-segment-0002',
          geometryVersionId: null,
          ordinal: 1,
        }),
      ],
    });
    expect(transaction).not.toHaveProperty('routeHoldPlacement');
  });

  it('线路下线会在同一事务退役版本并撤销公开链接，但不删除历史反馈', async () => {
    const transaction = {
      $executeRaw: vi.fn().mockResolvedValue(1),
      route: {
        findFirst: vi.fn().mockResolvedValue({
          id: 'route-1',
          versions: [{ id: 'version-1' }],
        }),
        update: vi.fn().mockResolvedValue({}),
      },
      routeVersion: { update: vi.fn().mockResolvedValue({}) },
      routePublicLink: { updateMany: vi.fn().mockResolvedValue({ count: 1 }) },
      auditEvent: { create: vi.fn().mockResolvedValue({}) },
    };
    const prisma = {
      $transaction: vi.fn(async (callback) => callback(transaction)),
    } as unknown as PrismaService;
    const audit = { record: vi.fn().mockResolvedValue({}) } as unknown as AuditService;
    const service = new RouteOperationsService(
      prisma,
      audit,
      new AccessControlService(),
      {} as TokenService,
    );
    vi.spyOn(service, 'get').mockResolvedValue({ id: 'route-1', status: 'REMOVED' } as never);

    await service.retire(session, 'route-1');

    expect(transaction.route.update).toHaveBeenCalledWith({
      where: { id: 'route-1' },
      data: expect.objectContaining({ status: 'REMOVED', retiredAt: expect.any(Date) }),
    });
    expect(transaction.routeVersion.update).toHaveBeenCalledWith({
      where: { id: 'version-1' },
      data: expect.objectContaining({ status: 'RETIRED', retiredAt: expect.any(Date) }),
    });
    expect(transaction.routePublicLink.updateMany).toHaveBeenCalledWith({
      where: expect.objectContaining({ routeId: 'route-1', status: 'ACTIVE' }),
      data: expect.objectContaining({ status: 'REVOKED', activeRouteKey: null }),
    });
    expect(transaction).not.toHaveProperty('routeFeedback');
  });
});
