import {
  Body,
  Controller,
  Get,
  Headers,
  Param,
  Post,
  Put,
  Query,
  Res,
  StreamableFile,
  UseGuards,
} from '@nestjs/common';
import { ApiCookieAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import type { FastifyReply } from 'fastify';
import { CurrentSessionContext } from '../auth/current-session.decorator';
import { SessionGuard } from '../auth/session.guard';
import type { CurrentSession } from '../auth/session.service';
import {
  parseCameraObservation,
  parseCameraObservationId,
  parseListCameraObservations,
  parseReviewCameraObservation,
} from './camera-observation.dto';
import { CameraObservationEvidenceService } from './camera-observation-evidence.service';
import { CameraObservationService } from './camera-observation.service';
import { parseSaveCameraRouteDefinition } from './camera-route-definition.dto';
import { CameraRouteDefinitionService } from './camera-route-definition.service';
import { CameraService } from './camera.service';
import { CameraSnapshotService } from './camera-snapshot.service';
import { CameraWorkerStatusService } from './camera-worker-status.service';

@ApiTags('camera')
@ApiCookieAuth()
@UseGuards(SessionGuard)
@Controller('camera')
export class CameraController {
  constructor(
    private readonly camera: CameraService,
    private readonly observations: CameraObservationService,
    private readonly evidence: CameraObservationEvidenceService,
    private readonly routeDefinitions: CameraRouteDefinitionService,
    private readonly snapshots: CameraSnapshotService,
    private readonly workerStatus: CameraWorkerStatusService,
  ) {}

  @Get('live')
  @ApiOperation({ summary: '读取当前岩馆的只读实时摄像头播放配置' })
  live(@CurrentSessionContext() session: CurrentSession) {
    return this.camera.live(session);
  }

  @Get('worker-status')
  @ApiOperation({ summary: '读取视觉 Worker 最近一次真实心跳和监控线路数量' })
  workerStatusSnapshot(@CurrentSessionContext() session: CurrentSession) {
    return this.workerStatus.get(session);
  }

  @Get('snapshot')
  @ApiOperation({ summary: '从实时流截取一张用于线路视觉配置的高清静态画面' })
  async snapshot(@CurrentSessionContext() session: CurrentSession, @Res() reply: FastifyReply) {
    const snapshot = await this.snapshots.capture(session);
    return reply
      .type('image/jpeg')
      .header('Cache-Control', 'private, no-store')
      .header('X-Camera-Snapshot-Captured-At', snapshot.capturedAt.toISOString())
      .header('X-Camera-Snapshot-Stale', String(snapshot.stale))
      .send(snapshot.image);
  }

  @Get('route-definitions')
  @ApiOperation({ summary: '读取主摄像头的多线路视觉配置工作区' })
  routeDefinitionWorkspace(@CurrentSessionContext() session: CurrentSession) {
    return this.routeDefinitions.workspace(session);
  }

  @Put('route-definitions')
  @ApiOperation({ summary: '保存用户确认的线路岩点、起点、终点和识别区域' })
  saveRouteDefinition(@CurrentSessionContext() session: CurrentSession, @Body() body: unknown) {
    return this.routeDefinitions.save(session, parseSaveCameraRouteDefinition(body));
  }

  @Get('observations')
  @ApiOperation({ summary: '读取视觉 Worker 最近提交的真实攀爬观察' })
  listObservations(@CurrentSessionContext() session: CurrentSession, @Query() query: unknown) {
    return this.observations.list(session, parseListCameraObservations(query));
  }

  @Get('observations/:observationId')
  @ApiOperation({ summary: '读取单次识别的算法事件、复核结论和录像状态' })
  getObservation(
    @CurrentSessionContext() session: CurrentSession,
    @Param('observationId') observationId: unknown,
  ) {
    return this.observations.get(session, parseCameraObservationId(observationId));
  }

  @Get('observations/:observationId/evidence')
  @ApiOperation({ summary: '按权限和 HTTP Range 播放尚未过期的识别录像' })
  async getObservationEvidence(
    @CurrentSessionContext() session: CurrentSession,
    @Param('observationId') observationId: unknown,
    @Headers('range') range: string | undefined,
    @Res({ passthrough: true }) reply: FastifyReply,
  ) {
    const result = await this.evidence.get(session, parseCameraObservationId(observationId), range);
    reply.header('Accept-Ranges', 'bytes').header('Cache-Control', 'private, no-store');
    if (result.range) {
      reply
        .code(206)
        .header(
          'Content-Range',
          `bytes ${result.range.start}-${result.range.end}/${result.evidence.sizeBytes}`,
        );
    }
    return new StreamableFile(result.stream, {
      type: result.evidence.contentType,
      length: result.range?.length ?? result.evidence.sizeBytes,
      disposition: 'inline',
    });
  }

  @Post('observations/:observationId/reviews')
  @ApiOperation({ summary: '追加人工复核结论，保留原始算法判定' })
  reviewObservation(
    @CurrentSessionContext() session: CurrentSession,
    @Param('observationId') observationId: unknown,
    @Body() body: unknown,
  ) {
    return this.observations.review(
      session,
      parseCameraObservationId(observationId),
      parseReviewCameraObservation(body),
    );
  }

  @Post('observations')
  @ApiOperation({ summary: '幂等写入视觉 Worker 的攀爬观察与可复核证据' })
  createObservation(@CurrentSessionContext() session: CurrentSession, @Body() body: unknown) {
    return this.observations.create(session, parseCameraObservation(body));
  }
}
