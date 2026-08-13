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
});
