import { CameraObservationEvidenceStatus, MembershipRole } from '@prisma/client';
import { createHash } from 'node:crypto';
import { Readable } from 'node:stream';
import { describe, expect, it, vi } from 'vitest';
import type { CurrentSession } from '../auth/session.service';
import { CameraObservationEvidenceService } from './camera-observation-evidence.service';

const session = {
  role: MembershipRole.L2_ADMIN,
  account: { id: 'account-1', email: 'reviewer@example.com' },
  organization: { id: 'organization-1', name: '测试岩馆' },
} as CurrentSession;

function serviceWith(prisma: object, storage: object) {
  return new CameraObservationEvidenceService(
    prisma as never,
    storage as never,
    { enqueue: vi.fn() } as never,
    { record: vi.fn() } as never,
    { assert: vi.fn() } as never,
    { values: { CAMERA_WORKER_ORGANIZATION_ID: session.organization.id } } as never,
  );
}

describe('CameraObservationEvidenceService', () => {
  it('流式校验并保存有效线路识别录像', async () => {
    const content = Buffer.from('camera-evidence');
    const checksumSha256 = createHash('sha256').update(content).digest('hex');
    const evidence = {
      id: 'evidence-1',
      status: CameraObservationEvidenceStatus.AVAILABLE,
      contentType: 'video/mp4',
      sizeBytes: content.length,
      durationMs: 42000,
      expiresAt: new Date(Date.now() + 60_000),
      expiredAt: null,
    };
    const prisma = {
      climbObservation: {
        findFirst: vi.fn().mockResolvedValue({
          id: 'observation-1',
          metadata: { requiresReview: true },
          evidence: null,
        }),
      },
      cameraObservationEvidence: { create: vi.fn().mockResolvedValue(evidence) },
    };
    const storage = {
      putStream: vi.fn(async (_key, stream: Readable) => {
        for await (const chunk of stream) {
          // Consuming the stream exercises hashing without buffering in the service.
          expect(chunk).toBeDefined();
        }
      }),
      remove: vi.fn(),
    };
    const service = serviceWith(prisma, storage);

    const result = await service.uploadFromWorker('observation-1', Readable.from(content), {
      durationMs: 42000,
      sizeBytes: content.length,
      checksumSha256,
    });

    expect(result.id).toBe('evidence-1');
    expect(storage.putStream).toHaveBeenCalled();
    expect(prisma.cameraObservationEvidence.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ observationId: 'observation-1', checksumSha256 }),
      }),
    );
  });

  it('通过字节范围读取录像，避免整段载入 API 内存', async () => {
    const evidence = {
      id: 'evidence-1',
      objectKey: 'organization-1/camera/evidence.mp4',
      status: CameraObservationEvidenceStatus.AVAILABLE,
      contentType: 'video/mp4',
      sizeBytes: 1000,
      durationMs: 42000,
      expiresAt: new Date(Date.now() + 60_000),
      expiredAt: null,
    };
    const prisma = {
      cameraObservationEvidence: { findFirst: vi.fn().mockResolvedValue(evidence) },
    };
    const stream = Readable.from(Buffer.alloc(100));
    const storage = { getPartial: vi.fn().mockResolvedValue(stream) };
    const service = serviceWith(prisma, storage);

    const result = await service.get(session, 'observation-1', 'bytes=100-199');

    expect(result.range).toEqual({ start: 100, end: 199, length: 100 });
    expect(storage.getPartial).toHaveBeenCalledWith(evidence.objectKey, 100, 100);
  });
});
