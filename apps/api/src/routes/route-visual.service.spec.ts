import { MembershipRole } from '@prisma/client';
import { describe, expect, it, vi } from 'vitest';
import type { CurrentSession } from '../auth/session.service';
import type { AuditService } from '../common/audit.service';
import type { PrismaService } from '../database/prisma.service';
import { AccessControlService } from '../security/access-control.service';
import { RouteVisualService } from './route-visual.service';

const session: CurrentSession = {
  account: { id: 'owner-1', email: 'owner@example.com' },
  membership: { id: 'membership-1', displayName: '负责人' },
  organization: { id: 'org-1', name: '测试岩馆' },
  role: MembershipRole.L1_ADMIN,
  expiresAt: new Date(),
};

function routeRecord(wallSegmentId = 'wall-segment-0001') {
  return {
    id: 'route-1',
    code: 'R-004-Y',
    name: 'W04 黄线',
    status: 'DRAFT',
    color: 'YELLOW',
    grade: 'V3',
    versions: [
      {
        id: 'version-1',
        versionNumber: 1,
        status: 'DRAFT',
        color: 'YELLOW',
        grade: 'V3',
        wallSegments: [
          {
            wallSegmentId,
            wallSegment: {
              id: wallSegmentId,
              code: 'W04',
              name: 'W04 墙段',
              area: { code: 'TIANYU-1F', name: '天宇岩馆一楼', floorLabel: '1F' },
            },
          },
        ],
        visualAnnotations: [],
      },
    ],
  };
}

describe('RouteVisualService 线路视觉标注', () => {
  it('保存草稿时只接受当前线路版本关联墙段，并按数组顺序生成 ordinal', async () => {
    const transaction = {
      $executeRaw: vi.fn().mockResolvedValue(1),
      route: { findFirst: vi.fn().mockResolvedValue(routeRecord()) },
      routeVisualAnnotation: {
        create: vi.fn().mockResolvedValue({ id: 'annotation-1' }),
      },
      routeVisualPoint: {
        deleteMany: vi.fn().mockResolvedValue({ count: 0 }),
        createMany: vi.fn().mockResolvedValue({ count: 2 }),
      },
      auditEvent: { create: vi.fn().mockResolvedValue({}) },
    };
    const prisma = {
      $transaction: vi.fn(async (callback) => callback(transaction)),
    } as unknown as PrismaService;
    const service = new RouteVisualService(
      prisma,
      { record: vi.fn().mockResolvedValue({}) } as unknown as AuditService,
      new AccessControlService(),
    );
    vi.spyOn(service, 'get').mockResolvedValue({ route: { id: 'route-1' } } as never);

    await service.saveDraft(session, 'route-1', {
      points: [
        { wallSegmentId: 'wall-segment-0001', role: 'START', uNormalized: 0.2, vNormalized: 0.8 },
        { wallSegmentId: 'wall-segment-0001', role: 'FINISH', uNormalized: 0.7, vNormalized: 0.1 },
      ],
    });

    expect(transaction.routeVisualPoint.createMany).toHaveBeenCalledWith({
      data: [
        expect.objectContaining({ ordinal: 0, role: 'START' }),
        expect.objectContaining({ ordinal: 1, role: 'FINISH' }),
      ],
    });
  });

  it('拒绝把视觉点写入未关联的墙段', async () => {
    const transaction = {
      $executeRaw: vi.fn().mockResolvedValue(1),
      route: { findFirst: vi.fn().mockResolvedValue(routeRecord()) },
    };
    const prisma = {
      $transaction: vi.fn(async (callback) => callback(transaction)),
    } as unknown as PrismaService;
    const service = new RouteVisualService(prisma, {} as AuditService, new AccessControlService());
    await expect(
      service.saveDraft(session, 'route-1', {
        points: [
          {
            wallSegmentId: 'wall-segment-other',
            role: 'START',
            uNormalized: 0.2,
            vNormalized: 0.8,
          },
          {
            wallSegmentId: 'wall-segment-other',
            role: 'FINISH',
            uNormalized: 0.7,
            vNormalized: 0.1,
          },
        ],
      }),
    ).rejects.toThrow('视觉标注只能落在该线路关联的墙段上');
  });
});
