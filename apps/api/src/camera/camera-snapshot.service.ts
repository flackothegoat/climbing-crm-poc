import { Injectable, ServiceUnavailableException } from '@nestjs/common';
import { spawn } from 'node:child_process';
import type { CurrentSession } from '../auth/session.service';
import { AppConfigService } from '../config/app-config.service';
import { AccessControlService, Capability } from '../security/access-control.service';

const MAX_SNAPSHOT_BYTES = 15 * 1024 * 1024;

export type CameraSnapshot = {
  image: Buffer;
  capturedAt: Date;
  stale: boolean;
};

type SuccessfulSnapshot = Omit<CameraSnapshot, 'stale'>;

export class SnapshotCoordinator {
  private inFlight?: Promise<CameraSnapshot>;
  private lastSuccessful?: SuccessfulSnapshot;

  constructor(
    private readonly freshMs: number,
    private readonly maxStaleMs: number,
  ) {}

  capture(loader: () => Promise<Buffer>, now = Date.now()): Promise<CameraSnapshot> {
    if (this.lastSuccessful && now - this.lastSuccessful.capturedAt.getTime() < this.freshMs) {
      return Promise.resolve({ ...this.lastSuccessful, stale: false });
    }
    if (this.inFlight) return this.inFlight;

    const request = loader()
      .then((image) => {
        const successful = { image, capturedAt: new Date() };
        this.lastSuccessful = successful;
        return { ...successful, stale: false };
      })
      .catch((error: unknown) => {
        const latest = this.lastSuccessful;
        if (
          latest &&
          this.maxStaleMs > 0 &&
          Date.now() - latest.capturedAt.getTime() <= this.maxStaleMs
        ) {
          return { ...latest, stale: true };
        }
        throw error;
      })
      .finally(() => {
        if (this.inFlight === request) this.inFlight = undefined;
      });
    this.inFlight = request;
    return request;
  }
}

@Injectable()
export class CameraSnapshotService {
  private readonly coordinator: SnapshotCoordinator;

  constructor(
    private readonly config: AppConfigService,
    private readonly access: AccessControlService,
  ) {
    const environment = config.values;
    this.coordinator = new SnapshotCoordinator(
      environment.CAMERA_SNAPSHOT_CACHE_MS,
      environment.CAMERA_SNAPSHOT_STALE_MS,
    );
  }

  capture(session: CurrentSession) {
    this.access.assert(session, Capability.ASSET_READ);
    const environment = this.config.values;
    return this.coordinator.capture(() =>
      captureJpeg(environment.CAMERA_PROBE_URL, environment.CAMERA_SNAPSHOT_TIMEOUT_MS),
    );
  }
}

export function captureJpeg(streamUrl: string, timeoutMs: number): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const ffmpeg = spawn(
      'ffmpeg',
      [
        '-hide_banner',
        '-loglevel',
        'error',
        '-i',
        streamUrl,
        '-frames:v',
        '1',
        '-vf',
        'scale=1280:-2',
        '-f',
        'image2pipe',
        '-vcodec',
        'mjpeg',
        'pipe:1',
      ],
      { stdio: ['ignore', 'pipe', 'pipe'] },
    );
    const chunks: Buffer[] = [];
    const errors: Buffer[] = [];
    let bytes = 0;
    let errorBytes = 0;
    let settled = false;
    const finish = (error?: Error, image?: Buffer) => {
      if (settled) return;
      settled = true;
      clearTimeout(timeout);
      if (error) reject(error);
      else resolve(image!);
    };
    const timeout = setTimeout(() => {
      ffmpeg.kill('SIGKILL');
      finish(new ServiceUnavailableException('摄像头截图超时'));
    }, timeoutMs);

    ffmpeg.stdout.on('data', (chunk: Buffer) => {
      bytes += chunk.length;
      if (bytes > MAX_SNAPSHOT_BYTES) {
        ffmpeg.kill('SIGKILL');
        finish(new ServiceUnavailableException('摄像头截图数据异常'));
        return;
      }
      chunks.push(chunk);
    });
    ffmpeg.stderr.on('data', (chunk: Buffer) => {
      if (errorBytes >= 4096) return;
      errors.push(chunk.subarray(0, 4096 - errorBytes));
      errorBytes += chunk.length;
    });
    ffmpeg.on('error', () => finish(new ServiceUnavailableException('服务器缺少 FFmpeg')));
    ffmpeg.on('close', (code) => {
      const image = Buffer.concat(chunks);
      if (code === 0 && image.length > 0) return finish(undefined, image);
      const detail = Buffer.concat(errors).toString('utf8').trim();
      return finish(
        new ServiceUnavailableException(detail || `摄像头截图失败（FFmpeg ${code ?? 'unknown'}）`),
      );
    });
  });
}
