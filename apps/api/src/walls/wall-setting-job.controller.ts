import { Body, Controller, Get, Param, Post, Query, UseGuards } from '@nestjs/common';
import { ApiCookieAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { CurrentSessionContext } from '../auth/current-session.decorator';
import { SessionGuard } from '../auth/session.guard';
import type { CurrentSession } from '../auth/session.service';
import { RouteSettingAssetService } from './route-setting-asset.service';
import {
  parseCreateWallSettingJob,
  parseListRouteSettingAssets,
  parseWallSettingJobAction,
} from './wall-setting-job.dto';
import { WallSettingJobService } from './wall-setting-job.service';

@ApiTags('wall-setting-jobs')
@ApiCookieAuth()
@UseGuards(SessionGuard)
@Controller('wall-setting-jobs')
export class WallSettingJobController {
  constructor(
    private readonly jobs: WallSettingJobService,
    private readonly assets: RouteSettingAssetService,
  ) {}

  @Post()
  @ApiOperation({ summary: '创建或读取墙面当前定线任务' })
  createOrGet(@CurrentSessionContext() session: CurrentSession, @Body() body: unknown) {
    return this.jobs.createOrGet(session, parseCreateWallSettingJob(body));
  }

  @Get('assets')
  @ApiOperation({ summary: '读取可用于定线的真实扫描岩点与库存' })
  listAssets(@CurrentSessionContext() session: CurrentSession, @Query() query: unknown) {
    return this.assets.list(session, parseListRouteSettingAssets(query));
  }

  @Get(':jobId')
  @ApiOperation({ summary: '读取定线任务状态和预留' })
  get(@CurrentSessionContext() session: CurrentSession, @Param('jobId') jobId: string) {
    return this.jobs.get(session, jobId);
  }

  @Post(':jobId/lock')
  @ApiOperation({ summary: '锁定定线方案并原子预留岩点库存' })
  lock(
    @CurrentSessionContext() session: CurrentSession,
    @Param('jobId') jobId: string,
    @Body() body: unknown,
  ) {
    return this.jobs.lock(session, jobId, parseWallSettingJobAction(body));
  }

  @Post(':jobId/cancel')
  @ApiOperation({ summary: '取消定线任务并释放预留库存' })
  cancel(
    @CurrentSessionContext() session: CurrentSession,
    @Param('jobId') jobId: string,
    @Body() body: unknown,
  ) {
    return this.jobs.cancel(session, jobId, parseWallSettingJobAction(body));
  }

  @Post(':jobId/complete')
  @ApiOperation({ summary: '确认现场安装完成并将预留库存转为已上墙' })
  complete(
    @CurrentSessionContext() session: CurrentSession,
    @Param('jobId') jobId: string,
    @Body() body: unknown,
  ) {
    return this.jobs.complete(session, jobId, parseWallSettingJobAction(body));
  }
}
