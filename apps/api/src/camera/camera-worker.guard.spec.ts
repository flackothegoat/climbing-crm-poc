import type { ExecutionContext } from '@nestjs/common';
import { UnauthorizedException } from '@nestjs/common';
import { describe, expect, it } from 'vitest';
import { CameraWorkerGuard } from './camera-worker.guard';

const configuredToken = 'camera-worker-token-with-at-least-32-characters';

function contextWithToken(token?: string): ExecutionContext {
  return {
    switchToHttp: () => ({
      getRequest: () => ({ headers: token ? { 'x-camera-worker-token': token } : {} }),
    }),
  } as ExecutionContext;
}

describe('CameraWorkerGuard', () => {
  it('接受匹配的服务端 Worker token', () => {
    const guard = new CameraWorkerGuard({
      values: { CAMERA_WORKER_TOKEN: configuredToken },
    } as never);
    expect(guard.canActivate(contextWithToken(configuredToken))).toBe(true);
  });

  it('拒绝缺失或不匹配的 token', () => {
    const guard = new CameraWorkerGuard({
      values: { CAMERA_WORKER_TOKEN: configuredToken },
    } as never);
    expect(() => guard.canActivate(contextWithToken('wrong-token'))).toThrow(UnauthorizedException);
    expect(() => guard.canActivate(contextWithToken())).toThrow(UnauthorizedException);
  });
});
