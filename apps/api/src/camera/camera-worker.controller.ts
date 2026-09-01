import { Body, Controller, Get, Post, UseGuards } from '@nestjs/common';
import { ApiHeader, ApiOperation, ApiTags } from '@nestjs/swagger';
import { parseCameraObservation } from './camera-observation.dto';
import { CameraObservationService } from './camera-observation.service';
import { CameraRouteDefinitionService } from './camera-route-definition.service';
import { CameraWorkerGuard } from './camera-worker.guard';
import { parseCameraWorkerHeartbeat } from './camera-worker-status.dto';
import { CameraWorkerStatusService } from './camera-worker-status.service';

@ApiTags('camera-worker')
@ApiHeader({ name: 'x-camera-worker-token', required: true })
@UseGuards(CameraWorkerGuard)
@Controller('camera/worker')
export class CameraWorkerController {
  constructor(
    private readonly observations: CameraObservationService,
    private readonly routeDefinitions: CameraRouteDefinitionService,
    private readonly workerStatus: CameraWorkerStatusService,
  ) {}

  @Get('route-definitions')
  @ApiOperation({ summary: '向视觉 Worker 提供已确认的多线路摄像头定义' })
  routeDefinitionsForWorker() {
    return this.routeDefinitions.listForWorker();
  }

  @Post('observations')
  @ApiOperation({ summary: '由服务端视觉 Worker 幂等写入攀爬观察' })
  createObservation(@Body() body: unknown) {
    return this.observations.createFromWorker(parseCameraObservation(body));
  }

  @Post('heartbeat')
  @ApiOperation({ summary: '由视觉 Worker 上报实时流、线路定义和尝试状态' })
  heartbeat(@Body() body: unknown) {
    return this.workerStatus.record(parseCameraWorkerHeartbeat(body));
  }
}
