import { Controller, Get, ServiceUnavailableException } from '@nestjs/common';
import { PrismaService } from '../database/prisma.service';
import { ObjectCleanupService } from '../storage/object-cleanup.service';
import { ObjectStorageService } from '../storage/object-storage.service';

@Controller('health')
export class HealthController {
  constructor(
    private readonly prisma: PrismaService,
    private readonly storage: ObjectStorageService,
    private readonly cleanup: ObjectCleanupService,
  ) {}

  @Get()
  live() {
    return { status: 'ok', service: 'climbing-crm-api' };
  }

  @Get('live')
  liveness() {
    return this.live();
  }

  @Get('ready')
  async readiness() {
    try {
      await this.prisma.$queryRaw`SELECT 1`;
    } catch {
      throw new ServiceUnavailableException('数据库暂时不可用');
    }
    const objectStorage = this.storage.readiness();
    return {
      status: objectStorage.available ? 'ok' : 'degraded',
      dependencies: { database: 'ok', objectStorage },
      objectCleanup: await this.cleanup.metrics(),
    };
  }
}
