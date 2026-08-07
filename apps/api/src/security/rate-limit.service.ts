import { HttpException, HttpStatus, Injectable } from '@nestjs/common';
import { PrismaService } from '../database/prisma.service';
import { TokenService } from './token.service';

@Injectable()
export class RateLimitService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly tokens: TokenService,
  ) {}

  async assertAllowed(
    scope: string,
    subject: string,
    limit: number,
    windowMinutes: number,
  ): Promise<void> {
    const subjectKey = this.tokens.hash(subject.trim().toLowerCase());
    const now = new Date();
    const current = await this.prisma.rateLimitRecord.findUnique({
      where: { scope_subjectKey: { scope, subjectKey } },
    });
    if (!current || current.windowEnds <= now) {
      await this.startWindow(scope, subjectKey, windowMinutes);
      return;
    }
    if (current.count >= limit) {
      throw new HttpException('请求过于频繁，请稍后再试', HttpStatus.TOO_MANY_REQUESTS);
    }
    await this.prisma.rateLimitRecord.update({
      where: { id: current.id },
      data: { count: { increment: 1 } },
    });
  }

  private startWindow(scope: string, subjectKey: string, windowMinutes: number): Promise<unknown> {
    const windowEnds = new Date(Date.now() + windowMinutes * 60_000);
    return this.prisma.rateLimitRecord.upsert({
      where: { scope_subjectKey: { scope, subjectKey } },
      create: { scope, subjectKey, count: 1, windowEnds },
      update: { count: 1, windowEnds },
    });
  }
}
