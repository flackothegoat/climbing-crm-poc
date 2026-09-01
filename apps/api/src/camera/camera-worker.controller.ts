import { Body, Controller, Get, Post, UseGuards } from '@nestjs/common';
import { ApiHeader, ApiOperation, ApiTags } from '@nestjs/swagger';
import { parseCameraObservation } from './camera-observation.dto';
import { CameraObservationService } from './camera-observation.service';
import { CameraRouteDefinitionService } from './camera-route-definition.service';
import { CameraWorkerGuard } from './camera-worker.guard';

@ApiTags('camera-worker')
@ApiHeader({ name: 'x-camera-worker-token', required: true })
@UseGuards(CameraWorkerGuard)
@Controller('camera/worker')
export class CameraWorkerController {
  constructor(
    private readonly observations: CameraObservationService,
    private readonly routeDefinitions: CameraRouteDefinitionService,
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
}
