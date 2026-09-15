import {
  CameraObservationEvidenceState,
  CameraObservationReviewDecision,
  CameraObservationReviewStatus,
  ClimbObservationOutcome,
  ClimbObservationSource,
  MembershipRole,
} from '@prisma/client';
import { describe, expect, it, vi } from 'vitest';
import type { CurrentSession } from '../auth/session.service';
import { CameraObservationService } from './camera-observation.service';

const session = {
  role: MembershipRole.L2_ADMIN,
  account: { id: 'account-reviewer', email: 'reviewer@example.com' },
  organization: { id: 'organization-camera', name: '测试岩馆' },
} as CurrentSession;

function observation(id: string) {
  return {
    id,
    organizationId: session.organization.id,
    wallSegmentId: null,
    routeId: 'route-1',
    routeVersionId: 'route-version-1',
    outcome: ClimbObservationOutcome.FAILED,
    source: ClimbObservationSource.CAMERA,
    observedAt: new Date('2026-09-08T08:00:00.000Z'),
    climberKey: 'attempt-1',
    requestKey: 'request-1',
    correctsObservationId: null,
    createdByAccountId: null,
    reviewStatus: CameraObservationReviewStatus.UNREVIEWED,
    evidenceState: CameraObservationEvidenceState.NOT_RECORDED,
    metadata: { confidence: 0.68, requiresReview: true },
    createdAt: new Date('2026-09-08T08:00:01.000Z'),
    route: { id: 'route-1', code: 'W04-001', name: '蓝色测试线', color: 'BLUE' },
    routeVersion: { id: 'route-version-1', versionNumber: 1 },
    wallSegment: null,
    evidence: null,
    reviews: [],
  };
}

describe('CameraObservationService', () => {
  it('以稳定游标返回历史结果并区分待复核状态', async () => {
    const prisma = {
      climbObservation: {
        findMany: vi
          .fn()
          .mockResolvedValue([observation('observation-2'), observation('observation-1')]),
      },
    };
    const service = new CameraObservationService(
      prisma as never,
      { record: vi.fn() } as never,
      { assert: vi.fn() } as never,
      { values: {} } as never,
    );

    const result = await service.list(session, { pageSize: 1, reviewStatus: 'PENDING' });

    expect(result.items).toHaveLength(1);
    expect(result.items[0]?.evidenceState).toBe(CameraObservationEvidenceState.NOT_RECORDED);
    expect(result.nextCursor).toBe('observation-2');
    expect(prisma.climbObservation.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        take: 2,
        where: expect.objectContaining({
          reviewStatus: CameraObservationReviewStatus.UNREVIEWED,
          metadata: { path: ['requiresReview'], equals: true },
        }),
      }),
    );
  });

  it('追加改判记录并延长争议录像保留期', async () => {
    const updated = {
      ...observation('observation-1'),
      reviewStatus: CameraObservationReviewStatus.OVERRIDDEN,
      reviews: [
        {
          id: 'review-1',
          decision: CameraObservationReviewDecision.OVERRIDE_COMPLETED,
          finalOutcome: ClimbObservationOutcome.COMPLETED,
          comment: '录像显示已经稳定触达终点',
          createdAt: new Date('2026-09-08T09:00:00.000Z'),
          reviewedBy: { id: session.account.id, email: session.account.email },
        },
      ],
    };
    const transaction = {
      climbObservation: {
        findFirst: vi.fn().mockResolvedValue({
          id: 'observation-1',
          outcome: ClimbObservationOutcome.FAILED,
        }),
        update: vi.fn(),
        findUniqueOrThrow: vi.fn().mockResolvedValue(updated),
      },
      cameraObservationReview: {
        create: vi.fn().mockResolvedValue({ id: 'review-1' }),
      },
      cameraObservationEvidence: { updateMany: vi.fn() },
    };
    const prisma = { $transaction: vi.fn(async (callback) => callback(transaction)) };
    const audit = { record: vi.fn() };
    const service = new CameraObservationService(
      prisma as never,
      audit as never,
      { assert: vi.fn() } as never,
      { values: {} } as never,
    );

    const result = await service.review(session, 'observation-1', {
      decision: CameraObservationReviewDecision.OVERRIDE_COMPLETED,
      comment: '录像显示已经稳定触达终点',
    });

    expect(result.latestReview?.finalOutcome).toBe(ClimbObservationOutcome.COMPLETED);
    expect(transaction.climbObservation.update).toHaveBeenCalledWith({
      where: { id: 'observation-1' },
      data: { reviewStatus: CameraObservationReviewStatus.OVERRIDDEN },
    });
    expect(transaction.cameraObservationEvidence.updateMany).toHaveBeenCalled();
    expect(audit.record).toHaveBeenCalled();
  });
});
