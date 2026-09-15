import {
  BadRequestException,
  Body,
  Controller,
  Get,
  Headers,
  Param,
  Post,
  Put,
  UseGuards,
} from '@nestjs/common';
import type { Readable } from 'node:stream';
import { ApiHeader, ApiOperation, ApiTags } from '@nestjs/swagger';
import { RouteConfig } from '@nestjs/platform-fastify';
import {
  parseCameraObservation,
  parseCameraObservationEvidence,
  parseCameraObservationId,
} from './camera-observation.dto';
import { CameraObservationEvidenceService } from './camera-observation-evidence.service';
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
    private readonly evidence: CameraObservationEvidenceService,
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

  @Put('observations/:observationId/evidence')
  @RouteConfig({ bodyLimit: 128 * 1024 * 1024 })
  @ApiOperation({ summary: '由视觉 Worker 流式上传已匹配有效线路的完整尝试录像' })
  uploadEvidence(
    @Param('observationId') observationId: unknown,
    @Body() video: Readable,
    @Headers('content-length') sizeBytes: string | undefined,
    @Headers('x-video-duration-ms') durationMs: string | undefined,
    @Headers('x-video-sha256') checksumSha256: string | undefined,
  ) {
    if (!video || typeof video.pipe !== 'function') {
      throw new BadRequestException('录像请求体不能为空');
    }
    return this.evidence.uploadFromWorker(
      parseCameraObservationId(observationId),
      video,
      parseCameraObservationEvidence({ durationMs, sizeBytes, checksumSha256 }),
    );
  }

  @Post('observations/:observationId/evidence-failure')
  @ApiOperation({ summary: '由视觉 Worker 标记录像在重试后仍上传失败' })
  markEvidenceUploadFailed(@Param('observationId') observationId: unknown) {
    return this.evidence.markUploadFailed(parseCameraObservationId(observationId));
  }

  @Post('heartbeat')
  @ApiOperation({ summary: '由视觉 Worker 上报实时流、线路定义和尝试状态' })
  heartbeat(@Body() body: unknown) {
    return this.workerStatus.record(parseCameraWorkerHeartbeat(body));
  }
}
