import { describe, expect, it } from 'vitest';
import { readEnvironment } from './environment';

const required = {
  DATABASE_URL: 'postgresql://user:password@localhost:5432/database',
  MINIO_ACCESS_KEY: 'minio-user',
  MINIO_SECRET_KEY: 'minio-password',
};

describe('环境配置', () => {
  it('生产环境拒绝非安全会话 Cookie', () => {
    expect(() =>
      readEnvironment({ ...required, NODE_ENV: 'production', SESSION_COOKIE_SECURE: 'false' }),
    ).toThrow('生产环境必须启用安全 Cookie');
  });

  it('生产环境默认关闭 Swagger', () => {
    const environment = readEnvironment({
      ...required,
      NODE_ENV: 'production',
      SESSION_COOKIE_SECURE: 'true',
    });
    expect(environment.SWAGGER_ENABLED).toBe(false);
  });

  it('默认提供可覆盖的 H.264 摄像头播放配置', () => {
    const environment = readEnvironment(required);
    expect(environment.CAMERA_LIVE_ENABLED).toBe(true);
    expect(environment.CAMERA_PLAYER_URL).toContain('/wvp/#/play/share');
    expect(environment.CAMERA_RESOURCE_URL).toMatch(/^wss:\/\//);
    expect(environment.CAMERA_PROBE_URL).toMatch(/^https:\/\//);
    expect(environment.CAMERA_PROBE_TIMEOUT_MS).toBe(4000);
    expect(environment.CAMERA_SNAPSHOT_TIMEOUT_MS).toBe(20000);
    expect(environment.CAMERA_SNAPSHOT_STALE_MS).toBe(300000);
  });
});
