import { Injectable, Logger, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { ObjectCleanupStatus } from '@prisma/client';
import { PrismaService } from '../database/prisma.service';
import { ObjectStorageService } from './object-storage.service';

const cleanupIntervalMs = 60_000;

@Injectable()
export class ObjectCleanupService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(ObjectCleanupService.name);
  private timer?: NodeJS.Timeout;
  private processing = false;

  constructor(
    private readonly prisma: PrismaService,
    private readonly storage: ObjectStorageService,
  ) {}

  async onModuleInit(): Promise<void> {
    await this.runScheduled('启动时');
    this.timer = setInterval(() => void this.runScheduled('周期'), cleanupIntervalMs);
    this.timer.unref();
  }

  onModuleDestroy(): void {
    if (this.timer) clearInterval(this.timer);
  }

  async enqueue(objectKey: string, reason: string, error?: unknown): Promise<void> {
    await this.prisma.objectCleanupJob.upsert({
      where: { objectKey },
      create: {
        objectKey,
        reason,
        status: ObjectCleanupStatus.PENDING,
        lastError: errorMessage(error),
      },
      update: {
        reason,
        status: ObjectCleanupStatus.PENDING,
        lastError: errorMessage(error),
        nextAttemptAt: new Date(),
      },
    });
  }

  async processPending(limit = 50): Promise<{ completed: number; failed: number }> {
    const jobs = await this.prisma.objectCleanupJob.findMany({
      where: {
        status: { in: [ObjectCleanupStatus.PENDING, ObjectCleanupStatus.FAILED] },
        nextAttemptAt: { lte: new Date() },
      },
      orderBy: { createdAt: 'asc' },
      take: Math.min(Math.max(limit, 1), 100),
    });
    let completed = 0;
    let failed = 0;
    for (const job of jobs) {
      try {
        await this.storage.remove(job.objectKey);
        await this.prisma.objectCleanupJob.update({
          where: { id: job.id },
          data: {
            status: ObjectCleanupStatus.COMPLETED,
            attemptCount: { increment: 1 },
            completedAt: new Date(),
            lastError: null,
          },
        });
        completed += 1;
      } catch (error) {
        const attempts = job.attemptCount + 1;
        await this.prisma.objectCleanupJob.update({
          where: { id: job.id },
          data: {
            status: ObjectCleanupStatus.FAILED,
            attemptCount: attempts,
            lastError: errorMessage(error),
            nextAttemptAt: new Date(Date.now() + retryDelayMs(attempts)),
          },
        });
        failed += 1;
      }
    }
    return { completed, failed };
  }

  async metrics() {
    const [pending, failed, completed] = await this.prisma.$transaction([
      this.prisma.objectCleanupJob.count({ where: { status: ObjectCleanupStatus.PENDING } }),
      this.prisma.objectCleanupJob.count({ where: { status: ObjectCleanupStatus.FAILED } }),
      this.prisma.objectCleanupJob.count({ where: { status: ObjectCleanupStatus.COMPLETED } }),
    ]);
    return { pending, failed, completed };
  }

  private async runScheduled(source: string): Promise<void> {
    if (this.processing) return;
    this.processing = true;
    try {
      await this.processPending(20);
    } catch (error) {
      this.logger.warn(`${source}对象清理任务执行失败`, error);
    } finally {
      this.processing = false;
    }
  }
}

function retryDelayMs(attempt: number): number {
  return Math.min(60 * 60_000, 2 ** Math.min(attempt, 10) * 1_000);
}

function errorMessage(error: unknown): string | null {
  return error instanceof Error ? error.message.slice(0, 1_000) : null;
}
