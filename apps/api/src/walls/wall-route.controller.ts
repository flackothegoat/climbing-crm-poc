import { Body, Controller, Get, Param, Post, Put, Query, UseGuards } from '@nestjs/common';
import { ApiCookieAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { CurrentSessionContext } from '../auth/current-session.decorator';
import { SessionGuard } from '../auth/session.guard';
import type { CurrentSession } from '../auth/session.service';
import { ClimbObservationService } from './climb-observation.service';
import { RouteSettingService } from './route-setting.service';
import {
  parseCreateObservation,
  parseListObservations,
  parseSaveRouteSettingPlan,
  parseWallCode,
} from './wall-route.dto';
import { parseOptionalSettingJobId } from './wall-setting-job.dto';
import { WallService } from './wall.service';

@ApiTags('walls')
@ApiCookieAuth()
@UseGuards(SessionGuard)
@Controller('walls')
export class WallController {
  constructor(private readonly walls: WallService) {}

  @Get()
  @ApiOperation({ summary: '读取当前岩馆的墙面区域和墙段' })
  list(@CurrentSessionContext() session: CurrentSession) {
    return this.walls.list(session);
  }

  @Get(':wallCode')
  @ApiOperation({ summary: '读取当前岩馆的单个墙段与孔位' })
  get(@CurrentSessionContext() session: CurrentSession, @Param('wallCode') wallCode: unknown) {
    return this.walls.get(session, parseWallCode(wallCode));
  }

  @Post('demo-seeds/w06')
  @ApiOperation({ summary: '幂等创建 W01-W15 测绘估算与 W06 Dummy 线路事件' })
  seedW06(@CurrentSessionContext() session: CurrentSession) {
    return this.walls.seedW06Demo(session);
  }

  @Post('workspaces/w06')
  @ApiOperation({ summary: '幂等创建 W06 测绘墙面与孔位，不创建演示线路' })
  ensureW06Workspace(@CurrentSessionContext() session: CurrentSession) {
    return this.walls.ensureW06Workspace(session);
  }
}

@ApiTags('routes')
@ApiCookieAuth()
@UseGuards(SessionGuard)
@Controller('routes')
export class RouteSettingController {
  constructor(private readonly routes: RouteSettingService) {}

  @Get('setting-plan')
  @ApiOperation({ summary: '读取墙面的当前定线计划' })
  getPlan(
    @CurrentSessionContext() session: CurrentSession,
    @Query('wallCode') wallCode: unknown,
    @Query('jobId') jobId: unknown,
  ) {
    return this.routes.getPlan(session, parseWallCode(wallCode), parseOptionalSettingJobId(jobId));
  }

  @Put('setting-plan/:wallCode')
  @ApiOperation({ summary: '保存墙面的当前定线草稿' })
  savePlan(
    @CurrentSessionContext() session: CurrentSession,
    @Param('wallCode') wallCode: unknown,
    @Body() body: unknown,
  ) {
    return this.routes.savePlan(session, parseWallCode(wallCode), parseSaveRouteSettingPlan(body));
  }
}

@ApiTags('climb-observations')
@ApiCookieAuth()
@UseGuards(SessionGuard)
@Controller('climb-observations')
export class ClimbObservationController {
  constructor(private readonly observations: ClimbObservationService) {}

  @Get()
  @ApiOperation({ summary: '按墙面、线路和时间范围读取攀爬事件' })
  list(@CurrentSessionContext() session: CurrentSession, @Query() query: unknown) {
    return this.observations.list(session, parseListObservations(query));
  }

  @Get('summary')
  @ApiOperation({ summary: '按线路和结果聚合攀爬事件' })
  summary(@CurrentSessionContext() session: CurrentSession, @Query() query: unknown) {
    return this.observations.summary(session, parseListObservations(query));
  }

  @Post()
  @ApiOperation({ summary: '幂等新增一条人工攀爬事件' })
  create(@CurrentSessionContext() session: CurrentSession, @Body() body: unknown) {
    return this.observations.create(session, parseCreateObservation(body));
  }
}
