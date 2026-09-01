import { describe, expect, it, vi } from 'vitest';
import { CameraWorkerStatusService } from './camera-worker-status.service';

const session = {
  organization: { id: 'organization-1' },
} as never;

function service(now: number, organizationId = 'organization-1') {
  vi.setSystemTime(now);
  return new CameraWorkerStatusService(
    { assert: vi.fn() } as never,
    {
      values: {
        CAMERA_WORKER_TOKEN: 'x'.repeat(32),
        CAMERA_WORKER_ORGANIZATION_ID: organizationId,
      },
    } as never,
  );
}

describe('CameraWorkerStatusService', () => {
  it('reports a fresh online worker', () => {
    const subject = service(Date.parse('2026-09-01T04:00:10Z'));
    subject.record({
      status: 'ONLINE',
      detail: '等待攀爬者进入',
      routeDefinitionCount: 1,
      checkedAt: '2026-09-01T04:00:00Z',
    });
    expect(subject.get(session)).toMatchObject({ status: 'ONLINE', configured: true });
    vi.useRealTimers();
  });

  it('does not call a stale heartbeat online', () => {
    const subject = service(Date.parse('2026-09-01T04:01:00Z'));
    subject.record({
      status: 'ONLINE',
      detail: '等待攀爬者进入',
      routeDefinitionCount: 1,
      checkedAt: '2026-09-01T04:00:00Z',
    });
    expect(subject.get(session).status).toBe('OFFLINE');
    vi.useRealTimers();
  });

  it('keeps another organization unconfigured', () => {
    const subject = service(Date.now(), 'another-organization');
    expect(subject.get(session)).toEqual({
      status: 'NOT_CONFIGURED',
      configured: false,
      heartbeat: null,
    });
    vi.useRealTimers();
  });
});
