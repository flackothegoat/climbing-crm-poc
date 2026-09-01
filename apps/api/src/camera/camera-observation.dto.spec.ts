import { ClimbObservationOutcome } from '@prisma/client';
import { describe, expect, it } from 'vitest';
import { parseCameraObservation } from './camera-observation.dto';

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
});
