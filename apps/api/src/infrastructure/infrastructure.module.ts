import { Global, Module } from '@nestjs/common';
import { APP_FILTER, APP_INTERCEPTOR } from '@nestjs/core';
import { AuditService } from '../common/audit.service';
import { CorrelationIdInterceptor } from '../common/correlation-id.interceptor';
import { RequestContextService } from '../common/request-context.service';
import { SafeErrorFilter } from '../common/safe-error.filter';
import { AppConfigService } from '../config/app-config.service';
import { PrismaService } from '../database/prisma.service';
import { AccessControlService } from '../security/access-control.service';
import { RateLimitService } from '../security/rate-limit.service';
import { TokenService } from '../security/token.service';
import { ObjectCleanupService } from '../storage/object-cleanup.service';
import { ObjectStorageService } from '../storage/object-storage.service';

const exportedProviders = [
  AppConfigService,
  RequestContextService,
  PrismaService,
  TokenService,
  RateLimitService,
  AuditService,
  AccessControlService,
  ObjectStorageService,
  ObjectCleanupService,
];

@Global()
@Module({
  providers: [
    ...exportedProviders,
    { provide: APP_INTERCEPTOR, useClass: CorrelationIdInterceptor },
    { provide: APP_FILTER, useClass: SafeErrorFilter },
  ],
  exports: exportedProviders,
})
export class InfrastructureModule {}
