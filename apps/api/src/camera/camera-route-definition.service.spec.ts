import { MembershipRole } from '@prisma/client';
import { describe, expect, it, vi } from 'vitest';
import type { CurrentSession } from '../auth/session.service';
import { CameraRouteDefinitionService } from './camera-route-definition.service';

const session = {
  role: MembershipRole.L2_ADMIN,
  account: { id: 'account-camera-admin', email: 'camera@example.com' },
  organization: { id: 'organization-camera', name: '测试岩馆' },
} as CurrentSession;

const input = {
  routeId: 'route-camera-01',
  routeVersionId: 'route-version-camera-01',
  wallSegmentId: 'wall-segment-camera-01',
  referenceWidth: 1280,
  referenceHeight: 720,
  roi: { x1: 0.1, y1: 0.1, x2: 0.9, y2: 0.95 },
  holds: [
    {
      id: 'hold-1',
      x: 0.2,
      y: 0.8,
      width: 0.04,
      height: 0.05,
      colorHex: '#F2C94C',
      colorCluster: 'hue-2',
    },
    {
      id: 'hold-2',
      x: 0.7,
      y: 0.2,
      width: 0.04,
      height: 0.05,
      colorHex: '#F2C94C',
      colorCluster: 'hue-2',
    },
  ],
  startHoldIds: ['hold-1'],
  finishHoldIds: ['hold-2'],
};

describe('CameraRouteDefinitionService', () => {
  it('把用户确认的岩点定义绑定到线路版本和墙段', async () => {
    const created = {
      id: 'definition-camera-01',
      organizationId: session.organization.id,
      cameraKey: 'gym-wall-primary',
      revision: 1,
      roiX1: input.roi.x1,
      roiY1: input.roi.y1,
      roiX2: input.roi.x2,
      roiY2: input.roi.y2,
      referenceWidth: 1280,
      referenceHeight: 720,
      holds: input.holds,
      startHoldIds: input.startHoldIds,
      finishHoldIds: input.finishHoldIds,
      updatedAt: new Date('2026-08-27T08:00:00.000Z'),
      route: { id: input.routeId, code: 'Y01', name: '黄色测试线', color: 'YELLOW' },
      routeVersion: { id: input.routeVersionId, versionNumber: 1, status: 'DRAFT' },
      wallSegment: { id: input.wallSegmentId, code: 'W01', name: '主墙' },
    };
    const transaction = {
      routeVersion: {
        findFirst: vi.fn().mockResolvedValue({
          id: input.routeVersionId,
          wallSegments: [{ wallSegmentId: input.wallSegmentId }],
        }),
      },
      cameraRouteDefinition: {
        findUnique: vi.fn().mockResolvedValue(null),
        create: vi.fn().mockResolvedValue(created),
      },
    };
    const prisma = {
      $transaction: vi.fn(async (callback) => callback(transaction)),
    };
    const audit = { record: vi.fn().mockResolvedValue(undefined) };
    const access = { assert: vi.fn() };
    const service = new CameraRouteDefinitionService(
      prisma as never,
      audit as never,
      access as never,
      { values: {} } as never,
    );

    const result = await service.save(session, input);

    expect(result).toMatchObject({ id: created.id, revision: 1 });
    expect(transaction.cameraRouteDefinition.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          organizationId: session.organization.id,
          routeVersionId: input.routeVersionId,
          startHoldIds: ['hold-1'],
          finishHoldIds: ['hold-2'],
        }),
      }),
    );
    expect(audit.record).toHaveBeenCalled();
  });
});
