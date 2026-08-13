import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { HoldsModule } from '../holds/holds.module';
import { ClimbObservationService } from './climb-observation.service';
import { RouteSettingService } from './route-setting.service';
import {
  ClimbObservationController,
  RouteSettingController,
  WallController,
} from './wall-route.controller';
import { WallService } from './wall.service';
import { HoldInstallationController } from './hold-installation.controller';
import { HoldInstallationService } from './hold-installation.service';
import { WallSettingJobController } from './wall-setting-job.controller';
import { WallSettingJobService } from './wall-setting-job.service';
import { RouteSettingAssetService } from './route-setting-asset.service';

@Module({
  imports: [AuthModule, HoldsModule],
  controllers: [
    WallController,
    RouteSettingController,
    ClimbObservationController,
    HoldInstallationController,
    WallSettingJobController,
  ],
  providers: [
    WallService,
    RouteSettingService,
    ClimbObservationService,
    HoldInstallationService,
    WallSettingJobService,
    RouteSettingAssetService,
  ],
})
export class WallsModule {}
