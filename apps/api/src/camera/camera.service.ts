import { Injectable } from '@nestjs/common';
import type { CurrentSession } from '../auth/session.service';
import { AppConfigService } from '../config/app-config.service';
import { AccessControlService, Capability } from '../security/access-control.service';

@Injectable()
export class CameraService {
  private cachedProbe?: { expiresAt: number; value: Promise<CameraProbe> };

  constructor(
    private readonly config: AppConfigService,
    private readonly access: AccessControlService,
  ) {}

  async live(session: CurrentSession) {
    this.access.assert(session, Capability.ASSET_READ);
    const environment = this.config.values;
    const probe = environment.CAMERA_LIVE_ENABLED ? await this.probeLiveStream() : disabledProbe();
    return {
      id: 'gym-wall-primary',
      name: environment.CAMERA_LIVE_NAME,
      enabled: environment.CAMERA_LIVE_ENABLED,
      connectionStatus: probe.status,
      probe,
      device: {
        manufacturer: 'TP-LINK',
        model: 'TL-IPC48AN',
        channelId: '34020000001320000001',
      },
      player: {
        kind: 'PLATFORM_IFRAME' as const,
        url: environment.CAMERA_PLAYER_URL,
        resourceUrl: environment.CAMERA_RESOURCE_URL,
        transport: 'WSS-FLV' as const,
        codec: 'H264' as const,
      },
      caveat:
        probe.status === 'ONLINE'
          ? '服务器已读取到实时 FLV 媒体字节；播放器页面载入状态与媒体在线状态分开显示。'
          : '服务器未能在探测时限内读取实时 FLV 媒体字节，请检查 GB28181 推流和 WVP 媒体服务。',
    };
  }

  private probeLiveStream(): Promise<CameraProbe> {
    const now = Date.now();
    if (this.cachedProbe && this.cachedProbe.expiresAt > now) return this.cachedProbe.value;
    const value = this.runProbe();
    this.cachedProbe = {
      expiresAt: now + this.config.values.CAMERA_PROBE_CACHE_MS,
      value,
    };
    return value;
  }

  private async runProbe(): Promise<CameraProbe> {
    const startedAt = Date.now();
    const checkedAt = new Date(startedAt).toISOString();
    const controller = new AbortController();
    const timeout = setTimeout(
      () => controller.abort(),
      this.config.values.CAMERA_PROBE_TIMEOUT_MS,
    );
    try {
      const response = await fetch(this.config.values.CAMERA_PROBE_URL, {
        cache: 'no-store',
        headers: { Accept: 'video/x-flv' },
        signal: controller.signal,
      });
      if (!response.ok || !response.body) {
        throw new Error(`HTTP ${response.status}`);
      }
      const reader = response.body.getReader();
      const first = await reader.read();
      await reader.cancel();
      if (first.done || !first.value?.byteLength) throw new Error('媒体响应没有数据');
      return {
        status: 'ONLINE',
        checkedAt,
        latencyMs: Date.now() - startedAt,
        bytesReceived: first.value.byteLength,
        protocol: 'HTTPS-FLV',
      };
    } catch (error) {
      return {
        status: 'OFFLINE',
        checkedAt,
        latencyMs: Date.now() - startedAt,
        bytesReceived: 0,
        protocol: 'HTTPS-FLV',
        error: error instanceof Error ? error.message : '实时流探测失败',
      };
    } finally {
      clearTimeout(timeout);
      controller.abort();
    }
  }
}

type CameraProbe = {
  status: 'ONLINE' | 'OFFLINE' | 'UNKNOWN';
  checkedAt: string;
  latencyMs: number | null;
  bytesReceived: number;
  protocol: 'HTTPS-FLV';
  error?: string;
};

function disabledProbe(): CameraProbe {
  return {
    status: 'UNKNOWN',
    checkedAt: new Date().toISOString(),
    latencyMs: null,
    bytesReceived: 0,
    protocol: 'HTTPS-FLV',
    error: '摄像头实时视频已禁用',
  };
}
