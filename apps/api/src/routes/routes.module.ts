import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { PublicRouteService } from './public-route.service';
import { PublicRouteController, RouteOperationsController } from './route-operations.controller';
import { RouteOperationsService } from './route-operations.service';
import { RoutePhotoService } from './route-photo.service';
import { RouteVisualService } from './route-visual.service';

@Module({
  imports: [AuthModule],
  controllers: [RouteOperationsController, PublicRouteController],
  providers: [RouteOperationsService, PublicRouteService, RoutePhotoService, RouteVisualService],
})
export class RoutesModule {}
