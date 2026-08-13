import { ConflictException } from '@nestjs/common';
import { MembershipRole } from '@prisma/client';
import { describe, expect, it, vi } from 'vitest';
import type { CurrentSession } from '../auth/session.service';
import type { AuditService } from '../common/audit.service';
import type { PrismaService } from '../database/prisma.service';
import { AccessControlService } from '../security/access-control.service';
import { ClimbObservationService } from './climb-observation.service';

const session: CurrentSession = {
  account: { id: 'owner-1', email: 'owner@example.com' },
  membership: { id: 'membership-1', displayName: '老板' },
  organization: { id: 'org-1', name: '测试岩馆' },
  role: MembershipRole.L1_ADMIN,
  expiresAt: new Date(),
};

const input = {
  wallCode: 'W06',
  routeId: 'route-green',
  outcome: 'COMPLETED' as const,
  observedAt: '2026-08-06T02:00:00.000Z',
  requestKey: '75fc093c-974b-4b14-9d79-cd024be97319',
};

function createService(prisma: PrismaService) {
  const audit = { record: vi.fn().mockResolvedValue({}) } as unknown as AuditService;
  return { service: new ClimbObservationService(prisma, audit, new AccessControlService()), audit };
}

describe('ClimbObservationService 租户与幂等', () => {
  it('按 Session 组织和墙面查找路线后写入人工事件', async () => {
    const created = {
      id: 'observation-1',
      route: { code: 'route-green' },
      outcome: 'COMPLETED',
      source: 'MANUAL',
      routeVersionId: 'version-1',
      observedAt: new Date(input.observedAt),
      climberKey: null,
    };
    const transaction = {
      $executeRaw: vi.fn().mockResolvedValue(1),
      route: {
        findUnique: vi.fn().mockResolvedValue({
          id: 'route-1',
          versions: [
            {
              id: 'version-1',
              status: 'PUBLISHED',
              wallSegments: [{ wallSegmentId: 'wall-1' }],
            },
          ],
        }),
      },
      climbObservation: {
        findUnique: vi.fn().mockResolvedValue(null),
        create: vi.fn().mockResolvedValue(created),
      },
      auditEvent: { create: vi.fn().mockResolvedValue({}) },
    };
    const prisma = {
      $transaction: vi.fn(async (callback) => callback(transaction)),
    } as unknown as PrismaService;
    const { service } = createService(prisma);

    await expect(service.create(session, input)).resolves.toMatchObject({
      id: 'observation-1',
      routeId: 'route-green',
      source: 'MANUAL',
    });
    expect(transaction.route.findUnique).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { organizationId_code: { organizationId: 'org-1', code: 'route-green' } },
      }),
    );
    expect(transaction.climbObservation.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ organizationId: 'org-1', createdByAccountId: 'owner-1' }),
      }),
    );
  });

  it('相同幂等键被用于不同结果时拒绝重放', async () => {
    const transaction = {
      $executeRaw: vi.fn().mockResolvedValue(1),
      climbObservation: {
        findUnique: vi.fn().mockResolvedValue({
          id: 'observation-1',
          route: { code: 'route-green' },
          wallSegment: { code: 'W06' },
          routeVersion: { id: 'version-1' },
          routeVersionId: 'version-1',
          outcome: 'FAILED',
          source: 'MANUAL',
          observedAt: new Date(input.observedAt),
          climberKey: null,
        }),
      },
    };
    const prisma = {
      $transaction: vi.fn(async (callback) => callback(transaction)),
    } as unknown as PrismaService;

    await expect(createService(prisma).service.create(session, input)).rejects.toBeInstanceOf(
      ConflictException,
    );
  });
});
