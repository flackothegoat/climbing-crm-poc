import { HttpException } from '@nestjs/common';
import { describe, expect, it, vi } from 'vitest';
import type { PrismaService } from '../database/prisma.service';
import type { TokenService } from './token.service';
import { RateLimitService } from './rate-limit.service';

function subject(current: { id: string; count: number; windowEnds: Date } | null) {
  const transaction = {
    $queryRaw: vi.fn().mockResolvedValue([{ pg_advisory_xact_lock: null }]),
    rateLimitRecord: {
      findUnique: vi.fn().mockResolvedValue(current),
      update: vi.fn().mockResolvedValue({}),
      upsert: vi.fn().mockResolvedValue({}),
    },
  };
  const prisma = {
    rateLimitRecord: {
      findUnique: vi.fn().mockResolvedValue(current),
      deleteMany: vi.fn().mockResolvedValue({ count: 1 }),
    },
    $transaction: vi.fn(async (callback) => callback(transaction)),
  } as unknown as PrismaService;
  const tokens = { hash: vi.fn().mockReturnValue('subject-hash') } as unknown as TokenService;
  return { service: new RateLimitService(prisma, tokens), transaction, prisma };
}

describe('RateLimitService', () => {
  it('在事务级 advisory lock 内原子消耗额度', async () => {
    const { service, transaction } = subject({
      id: 'rate-1',
      count: 2,
      windowEnds: new Date(Date.now() + 60_000),
    });
    await service.consume('login:email', 'OWNER@example.com', 10, 15);
    expect(transaction.$queryRaw).toHaveBeenCalledOnce();
    const query = transaction.$queryRaw.mock.calls[0]?.[0] as TemplateStringsArray;
    expect(query.join('')).toContain('SELECT 1 AS "locked"');
    expect(query.join('')).not.toContain('SELECT pg_advisory_xact_lock');
    expect(transaction.rateLimitRecord.update).toHaveBeenCalledWith({
      where: { id: 'rate-1' },
      data: { count: { increment: 1 } },
    });
  });

  it('达到限制后拒绝继续消耗额度', async () => {
    const { service, transaction } = subject({
      id: 'rate-1',
      count: 3,
      windowEnds: new Date(Date.now() + 60_000),
    });
    await expect(service.consume('register:ip', '127.0.0.1', 3, 60)).rejects.toBeInstanceOf(
      HttpException,
    );
    expect(transaction.rateLimitRecord.update).not.toHaveBeenCalled();
  });

  it('过期窗口从一次重新开始', async () => {
    const { service, transaction } = subject({
      id: 'rate-1',
      count: 99,
      windowEnds: new Date(Date.now() - 1_000),
    });
    await service.consume('register:ip', '127.0.0.1', 3, 60);
    expect(transaction.rateLimitRecord.upsert).toHaveBeenCalledWith(
      expect.objectContaining({ update: expect.objectContaining({ count: 1 }) }),
    );
  });
});
