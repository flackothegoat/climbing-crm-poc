import { HttpException, HttpStatus, Injectable } from '@nestjs/common';
import type { Prisma } from '@prisma/client';
import { PrismaService } from '../database/prisma.service';
import { TokenService } from './token.service';

@Injectable()
export class RateLimitService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly tokens: TokenService,
  ) {}

  async consume(
    scope: string,
    subject: string,
    limit: number,
    windowMinutes: number,
  ): Promise<void> {
    await this.increment(scope, subject, limit, windowMinutes);
  }

  async reset(scope: string, subject: string): Promise<void> {
    await this.prisma.rateLimitRecord.deleteMany({
      where: rateLimitKey(scope, this.subjectKey(subject)),
    });
  }

  private async increment(
    scope: string,
    subject: string,
    limit: number,
    windowMinutes: number,
  ): Promise<void> {
    const subjectKey = this.subjectKey(subject);
    await this.prisma.$transaction(async (transaction) => {
      await lockRateLimitKey(transaction, scope, subjectKey);
      const current = await transaction.rateLimitRecord.findUnique({
        where: { scope_subjectKey: rateLimitKey(scope, subjectKey) },
      });
      const now = new Date();
      if (!current || current.windowEnds <= now) {
        await transaction.rateLimitRecord.upsert({
          where: { scope_subjectKey: rateLimitKey(scope, subjectKey) },
          create: {
            scope,
            subjectKey,
            count: 1,
            windowEnds: new Date(now.getTime() + windowMinutes * 60_000),
          },
          update: {
            count: 1,
            windowEnds: new Date(now.getTime() + windowMinutes * 60_000),
          },
        });
        return;
      }
      if (current.count >= limit) throw rateLimited();
      await transaction.rateLimitRecord.update({
        where: { id: current.id },
        data: { count: { increment: 1 } },
      });
    });
  }

  private subjectKey(subject: string): string {
    return this.tokens.hash(subject.trim().toLowerCase());
  }
}

function rateLimitKey(scope: string, subjectKey: string) {
  return { scope, subjectKey };
}

async function lockRateLimitKey(
  transaction: Prisma.TransactionClient,
  scope: string,
  subjectKey: string,
): Promise<void> {
  await transaction.$queryRaw<{ locked: number }[]>`
    SELECT 1 AS "locked"
    FROM pg_advisory_xact_lock(hashtextextended(${`${scope}:${subjectKey}`}, 0))
  `;
}

function rateLimited(): HttpException {
  return new HttpException('请求过于频繁，请稍后再试', HttpStatus.TOO_MANY_REQUESTS);
}
