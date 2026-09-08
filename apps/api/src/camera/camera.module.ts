import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { CameraController } from './camera.controller';
import { CameraObservationEvidenceService } from './camera-observation-evidence.service';
import { CameraObservationService } from './camera-observation.service';
import { CameraRouteDefinitionService } from './camera-route-definition.service';
import { CameraService } from './camera.service';
import { CameraSnapshotService } from './camera-snapshot.service';
import { CameraWorkerController } from './camera-worker.controller';
import { CameraWorkerGuard } from './camera-worker.guard';
import { CameraWorkerStatusService } from './camera-worker-status.service';

@Module({
  imports: [AuthModule],
  controllers: [CameraController, CameraWorkerController],
  providers: [
    CameraService,
    CameraSnapshotService,
    CameraObservationService,
    CameraObservationEvidenceService,
    CameraRouteDefinitionService,
    CameraWorkerGuard,
    CameraWorkerStatusService,
  ],
})
export class CameraModule {}
