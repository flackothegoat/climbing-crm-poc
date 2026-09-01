import { ServiceUnavailableException } from '@nestjs/common';
import { describe, expect, it, vi } from 'vitest';
import { SnapshotCoordinator } from './camera-snapshot.service';

describe('SnapshotCoordinator', () => {
  it('reuses a fresh successful frame without starting FFmpeg again', async () => {
    const coordinator = new SnapshotCoordinator(5_000, 300_000);
    const loader = vi.fn().mockResolvedValue(Buffer.from('jpeg'));

    const first = await coordinator.capture(loader, 1_000);
    const second = await coordinator.capture(loader, first.capturedAt.getTime() + 1_000);

    expect(loader).toHaveBeenCalledTimes(1);
    expect(second).toMatchObject({ image: first.image, stale: false });
  });

  it('coalesces concurrent capture requests', async () => {
    const coordinator = new SnapshotCoordinator(0, 300_000);
    let resolveFrame!: (value: Buffer) => void;
    const loader = vi.fn(
      () =>
        new Promise<Buffer>((resolve) => {
          resolveFrame = resolve;
        }),
    );

    const first = coordinator.capture(loader);
    const second = coordinator.capture(loader);
    resolveFrame(Buffer.from('jpeg'));

    await expect(first).resolves.toMatchObject({ stale: false });
    await expect(second).resolves.toMatchObject({ stale: false });
    expect(loader).toHaveBeenCalledTimes(1);
  });

  it('returns the latest frame when a transient live-stream capture fails', async () => {
    const coordinator = new SnapshotCoordinator(0, 300_000);
    const successful = await coordinator.capture(() => Promise.resolve(Buffer.from('jpeg')));

    const fallback = await coordinator.capture(() =>
      Promise.reject(new ServiceUnavailableException('摄像头截图超时')),
    );

    expect(fallback).toMatchObject({ image: successful.image, stale: true });
  });

  it('does not hide a failure when no successful frame exists', async () => {
    const coordinator = new SnapshotCoordinator(0, 300_000);
    const error = new ServiceUnavailableException('摄像头截图超时');

    await expect(coordinator.capture(() => Promise.reject(error))).rejects.toBe(error);
  });
});
