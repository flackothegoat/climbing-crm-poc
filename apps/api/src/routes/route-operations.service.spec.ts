import { ClimbingColor, MembershipRole, RouteStatus } from '@prisma/client';
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
  it('默认线路列表只展示正常和已停用线路，显式状态查询仍可读取历史', async () => {
    const prisma = {
      route: { findMany: vi.fn().mockResolvedValue([]) },
    } as unknown as PrismaService;
    const service = new RouteOperationsService(
      prisma,
      {} as AuditService,
      new AccessControlService(),
      {} as TokenService,
    );

    await service.list(session, {});
    expect(prisma.route.findMany).toHaveBeenLastCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          status: { in: [RouteStatus.PUBLISHED, RouteStatus.INACTIVE] },
        }),
      }),
    );

    await service.list(session, { status: RouteStatus.REMOVED });
    expect(prisma.route.findMany).toHaveBeenLastCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({ status: RouteStatus.REMOVED }),
      }),
    );
  });

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

  it('省略编号时按墙段、日期和序号生成唯一业务编号', async () => {
    const transaction = {
      $executeRaw: vi.fn().mockResolvedValue(1),
      wallSegment: {
        findMany: vi.fn().mockResolvedValue([{ id: 'wall-segment-0001', areaId: 'area-1' }]),
        findFirst: vi.fn().mockResolvedValue({ code: 'W06' }),
      },
      wallSegmentAdjacency: { findMany: vi.fn().mockResolvedValue([]) },
      membership: { findFirst: vi.fn() },
      route: {
        findMany: vi.fn().mockResolvedValue([]),
        create: vi.fn().mockImplementation(({ data }) => ({ id: 'route-auto', code: data.code })),
      },
      routeVersion: { create: vi.fn().mockResolvedValue({ id: 'version-auto' }) },
      routeVersionWallSegment: { createMany: vi.fn().mockResolvedValue({ count: 1 }) },
      auditEvent: { create: vi.fn().mockResolvedValue({}) },
    };
    const prisma = {
      $transaction: vi.fn(async (callback) => callback(transaction)),
    } as unknown as PrismaService;
    const service = new RouteOperationsService(
      prisma,
      { record: vi.fn().mockResolvedValue({}) } as unknown as AuditService,
      new AccessControlService(),
      {} as TokenService,
    );
    vi.spyOn(service, 'get').mockResolvedValue({ id: 'route-auto' } as never);

    await service.create(session, {
      name: '黄色测试线',
      color: ClimbingColor.YELLOW,
      grade: 'V4',
      gradeSystem: 'V',
      styleTags: [],
      wallSegmentIds: ['wall-segment-0001'],
    });

    expect(transaction.route.create).toHaveBeenCalledWith({
      data: expect.objectContaining({ code: expect.stringMatching(/^W06-\d{6}-001$/) }),
    });
  });

  it('线路停用只改变业务状态，不退役版本或删除历史反馈', async () => {
    const transaction = {
      $executeRaw: vi.fn().mockResolvedValue(1),
      route: {
        findFirst: vi.fn().mockResolvedValue({
          id: 'route-1',
          versions: [{ id: 'version-1' }],
        }),
        update: vi.fn().mockResolvedValue({}),
      },
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
    vi.spyOn(service, 'get').mockResolvedValue({ id: 'route-1', status: 'INACTIVE' } as never);

    await service.retire(session, 'route-1');

    expect(transaction.route.update).toHaveBeenCalledWith({
      where: { id: 'route-1' },
      data: expect.objectContaining({ status: 'INACTIVE', retiredAt: expect.any(Date) }),
    });
    expect(transaction).not.toHaveProperty('routeVersion');
    expect(transaction).not.toHaveProperty('routePublicLink');
    expect(transaction).not.toHaveProperty('routeFeedback');
  });

  it('删除已停用线路会隐藏线路并退役版本，但不物理删除任何关联数据', async () => {
    const transaction = {
      $executeRaw: vi.fn().mockResolvedValue(1),
      route: {
        findFirst: vi.fn().mockResolvedValue({
          id: 'route-1',
          versions: [
            {
              id: 'version-1',
            },
          ],
        }),
        update: vi.fn().mockResolvedValue({}),
      },
      routeVersion: { updateMany: vi.fn().mockResolvedValue({ count: 1 }) },
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

    await expect(service.remove(session, 'route-1')).resolves.toEqual({
      id: 'route-1',
      status: RouteStatus.REMOVED,
    });
    expect(transaction.route.update).toHaveBeenCalledWith({
      where: { id: 'route-1' },
      data: expect.objectContaining({ status: RouteStatus.REMOVED }),
    });
    expect(transaction.routeVersion.updateMany).toHaveBeenCalledWith({
      where: expect.objectContaining({ routeId: 'route-1' }),
      data: expect.objectContaining({ status: 'RETIRED' }),
    });
    expect(transaction.route).not.toHaveProperty('delete');
    expect(transaction.routeVersion).not.toHaveProperty('delete');
  });

  it('恢复已停用线路时重新进入正常状态并保留原版本', async () => {
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
      auditEvent: { create: vi.fn().mockResolvedValue({}) },
    };
    const prisma = {
      $transaction: vi.fn(async (callback) => callback(transaction)),
    } as unknown as PrismaService;
    const service = new RouteOperationsService(
      prisma,
      { record: vi.fn().mockResolvedValue({}) } as unknown as AuditService,
      new AccessControlService(),
      {} as TokenService,
    );
    vi.spyOn(service, 'get').mockResolvedValue({ id: 'route-1', status: 'PUBLISHED' } as never);

    await service.restore(session, 'route-1');

    expect(transaction.route.update).toHaveBeenCalledWith({
      where: { id: 'route-1' },
      data: { status: RouteStatus.PUBLISHED, retiredAt: null },
    });
    expect(transaction.routeVersion.update).toHaveBeenCalledWith({
      where: { id: 'version-1' },
      data: { status: 'PUBLISHED', retiredAt: null },
    });
  });
});
