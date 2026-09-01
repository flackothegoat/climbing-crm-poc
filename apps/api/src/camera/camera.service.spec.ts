import { MembershipRole } from '@prisma/client';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { CurrentSession } from '../auth/session.service';
import { readEnvironment } from '../config/environment';
import { AccessControlService } from '../security/access-control.service';
import { CameraService } from './camera.service';

const session = {
  role: MembershipRole.L2_ADMIN,
  organization: { id: 'organization_test', name: '测试岩馆' },
} as CurrentSession;

describe('CameraService 实时播放配置', () => {
  afterEach(() => vi.unstubAllGlobals());

  it('读取到实时媒体字节后返回 ONLINE', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(
        new Response(Uint8Array.from([0x46, 0x4c, 0x56, 0x01]), {
          status: 200,
          headers: { 'content-type': 'video/x-flv' },
        }),
      ),
    );
    const values = readEnvironment({
      DATABASE_URL: 'postgresql://user:password@localhost:5432/database',
      MINIO_ACCESS_KEY: 'minio-user',
      MINIO_SECRET_KEY: 'minio-password',
    });
    const service = new CameraService({ values } as never, new AccessControlService());
    const result = await service.live(session);
    expect(result.enabled).toBe(true);
    expect(result.connectionStatus).toBe('ONLINE');
    expect(result.probe.bytesReceived).toBe(4);
    expect(result.player).toMatchObject({ transport: 'WSS-FLV', codec: 'H264' });
    expect(result.player.url).toContain('/wvp/#/play/share');
  });

  it('探测失败时返回 OFFLINE 而不是把 iframe onload 当在线', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('connect timeout')));
    const values = readEnvironment({
      DATABASE_URL: 'postgresql://user:password@localhost:5432/database',
      MINIO_ACCESS_KEY: 'minio-user',
      MINIO_SECRET_KEY: 'minio-password',
      CAMERA_PROBE_CACHE_MS: '0',
    });
    const service = new CameraService({ values } as never, new AccessControlService());
    const result = await service.live(session);
    expect(result.connectionStatus).toBe('OFFLINE');
    expect(result.probe.error).toBe('connect timeout');
  });
});
