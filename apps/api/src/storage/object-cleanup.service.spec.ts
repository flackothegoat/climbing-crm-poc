import { ObjectCleanupStatus } from '@prisma/client';
import { describe, expect, it, vi } from 'vitest';
import type { PrismaService } from '../database/prisma.service';
import type { ObjectStorageService } from './object-storage.service';
import { ObjectCleanupService } from './object-cleanup.service';

function subject(remove: ReturnType<typeof vi.fn>) {
  const job = {
    id: 'cleanup-1',
    objectKey: 'holds/orphan.glb',
    attemptCount: 0,
  };
  const prisma = {
    objectCleanupJob: {
      findMany: vi.fn().mockResolvedValue([job]),
      update: vi.fn().mockResolvedValue({}),
    },
  } as unknown as PrismaService;
  const storage = { remove } as unknown as ObjectStorageService;
  return { service: new ObjectCleanupService(prisma, storage), prisma, job };
}

describe('ObjectCleanupService', () => {
  it('对象删除成功后持久化完成状态', async () => {
    const { service, prisma, job } = subject(vi.fn().mockResolvedValue(undefined));

    await expect(service.processPending()).resolves.toEqual({ completed: 1, failed: 0 });
    expect(prisma.objectCleanupJob.update).toHaveBeenCalledWith({
      where: { id: job.id },
      data: expect.objectContaining({
        status: ObjectCleanupStatus.COMPLETED,
        attemptCount: { increment: 1 },
        lastError: null,
      }),
    });
  });

  it('对象删除失败时保留任务并延迟重试', async () => {
    const { service, prisma, job } = subject(vi.fn().mockRejectedValue(new Error('offline')));

    await expect(service.processPending()).resolves.toEqual({ completed: 0, failed: 1 });
    expect(prisma.objectCleanupJob.update).toHaveBeenCalledWith({
      where: { id: job.id },
      data: expect.objectContaining({
        status: ObjectCleanupStatus.FAILED,
        attemptCount: 1,
        lastError: 'offline',
        nextAttemptAt: expect.any(Date),
      }),
    });
  });
});
