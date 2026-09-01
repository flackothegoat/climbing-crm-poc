import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { CameraController } from './camera.controller';
import { CameraObservationService } from './camera-observation.service';
import { CameraRouteDefinitionService } from './camera-route-definition.service';
import { CameraService } from './camera.service';
import { CameraSnapshotService } from './camera-snapshot.service';
import { CameraWorkerController } from './camera-worker.controller';
import { CameraWorkerGuard } from './camera-worker.guard';

@Module({
  imports: [AuthModule],
  controllers: [CameraController, CameraWorkerController],
  providers: [
    CameraService,
    CameraSnapshotService,
    CameraObservationService,
    CameraRouteDefinitionService,
    CameraWorkerGuard,
  ],
})
export class CameraModule {}
