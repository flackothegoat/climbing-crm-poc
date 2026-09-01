import { describe, expect, it } from 'vitest';
import { parseCameraWorkerHeartbeat } from './camera-worker-status.dto';

describe('camera worker heartbeat DTO', () => {
  it('accepts a valid heartbeat', () => {
    expect(
      parseCameraWorkerHeartbeat({
        status: 'ONLINE',
        detail: '等待攀爬者进入',
        activeAttempt: null,
        routeDefinitionCount: 1,
        checkedAt: '2026-09-01T04:00:00+00:00',
      }),
    ).toMatchObject({ status: 'ONLINE', routeDefinitionCount: 1 });
  });

  it('rejects invalid route counts and timestamps', () => {
    expect(() =>
      parseCameraWorkerHeartbeat({
        status: 'ONLINE',
        detail: 'ok',
        routeDefinitionCount: -1,
        checkedAt: 'not-a-time',
      }),
    ).toThrow();
  });
});
