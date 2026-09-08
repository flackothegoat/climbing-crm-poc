import { CameraObservationReviewDecision, ClimbObservationOutcome } from '@prisma/client';
import { describe, expect, it } from 'vitest';
import {
  parseCameraObservation,
  parseCameraObservationEvidence,
  parseListCameraObservations,
  parseReviewCameraObservation,
} from './camera-observation.dto';

const valid = {
  requestKey: '0b310942-4ab0-4bd1-81ba-c614ba2e73af',
  routeId: 'route_test',
  routeVersionId: 'route_version_test',
  observedAt: '2026-08-26T08:00:00.000Z',
  analysis: {
    schemaVersion: 1,
    attemptId: 'attempt-01',
    modelVersion: 'yolo11n-pose',
    calibrationId: 'yellow-camera-01',
    outcome: ClimbObservationOutcome.COMPLETED,
    failureReasons: [],
    confidence: 0.68,
    requiresReview: true,
    startedAtS: 13.02,
    finishReachedAtS: 40.46,
    fallAtS: null,
    events: [],
  },
};

describe('摄像头攀爬观察 DTO', () => {
  it('接受可审计的真实模型输出', () => {
    expect(parseCameraObservation(valid).analysis.outcome).toBe('COMPLETED');
  });

  it('拒绝越界置信度', () => {
    expect(() =>
      parseCameraObservation({
        ...valid,
        analysis: { ...valid.analysis, confidence: 1.1 },
      }),
    ).toThrow();
  });

  it('解析历史查询条件并限制单页数量', () => {
    expect(
      parseListCameraObservations({
        pageSize: '10',
        query: 'W04',
        reviewStatus: 'PENDING',
        observedFrom: '2026-09-01T00:00:00.000+08:00',
      }),
    ).toMatchObject({ pageSize: 10, query: 'W04', reviewStatus: 'PENDING' });
    expect(() => parseListCameraObservations({ pageSize: 51 })).toThrow();
  });

  it('改判必须提供原因', () => {
    expect(() =>
      parseReviewCameraObservation({
        decision: CameraObservationReviewDecision.OVERRIDE_COMPLETED,
      }),
    ).toThrow();
    expect(
      parseReviewCameraObservation({
        decision: CameraObservationReviewDecision.OVERRIDE_COMPLETED,
        comment: '视频显示双手稳定触达终点岩点',
      }).comment,
    ).toContain('终点');
  });

  it('校验 Worker 上传的录像元数据', () => {
    expect(
      parseCameraObservationEvidence({
        durationMs: '42000',
        sizeBytes: '1024000',
        checksumSha256: 'a'.repeat(64),
      }),
    ).toMatchObject({ durationMs: 42000, sizeBytes: 1024000 });
    expect(() =>
      parseCameraObservationEvidence({
        durationMs: 631000,
        sizeBytes: 1024,
        checksumSha256: 'a'.repeat(64),
      }),
    ).toThrow();
  });
});
