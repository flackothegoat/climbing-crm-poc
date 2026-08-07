import { Controller, Get, Module } from '@nestjs/common';
import { APP_FILTER, APP_INTERCEPTOR } from '@nestjs/core';
import { AuthController } from './auth/auth.controller';
import { AuthService } from './auth/auth.service';
import { SessionService } from './auth/session.service';
import { AuditService } from './common/audit.service';
import { CorrelationIdInterceptor } from './common/correlation-id.interceptor';
import { SafeErrorFilter } from './common/safe-error.filter';
import { PrismaService } from './database/prisma.service';
import { RateLimitService } from './security/rate-limit.service';
import { TokenService } from './security/token.service';
import { SessionGuard } from './auth/session.guard';
import { AccessControlService } from './security/access-control.service';
import { TeamController } from './team/team.controller';
import { TeamInvitationService } from './team/team-invitation.service';
import { TeamMemberService } from './team/team-member.service';
import { HoldController } from './holds/hold.controller';
import { HoldCategoryService } from './holds/hold-category.service';
import { HoldInventoryService } from './holds/hold-inventory.service';
import { HoldSpecificationService } from './holds/hold-specification.service';
import { HoldSpecificationWriter } from './holds/hold-specification.writer';
import { ObjectStorageService } from './storage/object-storage.service';
import { HoldAssetService } from './holds/hold-asset.service';
import { HoldInitializationService } from './holds/hold-initialization.service';
import { HoldScanService } from './holds/hold-scan.service';
import { HoldRecordDeletionService } from './holds/hold-record-deletion.service';
import {
  ClimbObservationController,
  RouteSettingController,
  WallController,
} from './walls/wall-route.controller';
import { WallService } from './walls/wall.service';
import { RouteSettingService } from './walls/route-setting.service';
import { ClimbObservationService } from './walls/climb-observation.service';

@Controller('health')
class HealthController {
  @Get()
  getHealth() {
    return { status: 'ok', service: 'climbing-crm-api' };
  }
}

@Module({
  controllers: [
    HealthController,
    AuthController,
    TeamController,
    HoldController,
    WallController,
    RouteSettingController,
    ClimbObservationController,
  ],
  providers: [
    PrismaService,
    TokenService,
    RateLimitService,
    AuditService,
    AuthService,
    SessionService,
    SessionGuard,
    AccessControlService,
    TeamInvitationService,
    TeamMemberService,
    HoldCategoryService,
    HoldSpecificationService,
    HoldSpecificationWriter,
    HoldInventoryService,
    ObjectStorageService,
    HoldAssetService,
    HoldInitializationService,
    HoldScanService,
    HoldRecordDeletionService,
    WallService,
    RouteSettingService,
    ClimbObservationService,
    { provide: APP_INTERCEPTOR, useClass: CorrelationIdInterceptor },
    { provide: APP_FILTER, useClass: SafeErrorFilter },
  ],
})
export class AppModule {}
