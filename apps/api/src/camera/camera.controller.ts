import { Body, Controller, Get, Post, Put, Query, Res, UseGuards } from '@nestjs/common';
import { ApiCookieAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import type { FastifyReply } from 'fastify';
import { CurrentSessionContext } from '../auth/current-session.decorator';
import { SessionGuard } from '../auth/session.guard';
import type { CurrentSession } from '../auth/session.service';
import { parseCameraObservation, parseListCameraObservations } from './camera-observation.dto';
import { CameraObservationService } from './camera-observation.service';
import { parseSaveCameraRouteDefinition } from './camera-route-definition.dto';
import { CameraRouteDefinitionService } from './camera-route-definition.service';
import { CameraService } from './camera.service';
import { CameraSnapshotService } from './camera-snapshot.service';

@ApiTags('camera')
@ApiCookieAuth()
@UseGuards(SessionGuard)
@Controller('camera')
export class CameraController {
  constructor(
    private readonly camera: CameraService,
    private readonly observations: CameraObservationService,
    private readonly routeDefinitions: CameraRouteDefinitionService,
    private readonly snapshots: CameraSnapshotService,
  ) {}

  @Get('live')
  @ApiOperation({ summary: '读取当前岩馆的只读实时摄像头播放配置' })
  live(@CurrentSessionContext() session: CurrentSession) {
    return this.camera.live(session);
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

  @Post('observations')
  @ApiOperation({ summary: '幂等写入视觉 Worker 的攀爬观察与可复核证据' })
  createObservation(@CurrentSessionContext() session: CurrentSession, @Body() body: unknown) {
    return this.observations.create(session, parseCameraObservation(body));
  }
}
