import {
  BadRequestException,
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Patch,
  Post,
  Query,
  Req,
  StreamableFile,
  UseGuards,
} from '@nestjs/common';
import { ApiCookieAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import type { FastifyRequest } from 'fastify';
import { CurrentSessionContext } from '../auth/current-session.decorator';
import { SessionGuard } from '../auth/session.guard';
import type { CurrentSession } from '../auth/session.service';
import {
  parseAnalyticsQuery,
  parseCreateRoute,
  parseCreateWall,
  parseListRoutes,
  parsePublicRouteToken,
  parseRouteId,
  parseSubmitFeedback,
  parseUpdateRoute,
} from './route-operations.dto';
import { RouteOperationsService } from './route-operations.service';
import { RoutePhotoService } from './route-photo.service';
import { PublicRouteService } from './public-route.service';

@ApiTags('route-operations')
@ApiCookieAuth()
@UseGuards(SessionGuard)
@Controller('route-operations')
export class RouteOperationsController {
  constructor(
    private readonly routes: RouteOperationsService,
    private readonly photos: RoutePhotoService,
  ) {}

  @Get('context')
  @ApiOperation({ summary: '读取线路建档可用墙段和定线员' })
  context(@CurrentSessionContext() session: CurrentSession) {
    return this.routes.context(session);
  }

  @Post('walls')
  @ApiOperation({ summary: '创建不依赖三维模型的墙区和墙段档案' })
  createWall(@CurrentSessionContext() session: CurrentSession, @Body() body: unknown) {
    return this.routes.createWall(session, parseCreateWall(body));
  }

  @Get('analytics')
  @ApiOperation({ summary: '按线路版本聚合二维码反馈样本' })
  analytics(@CurrentSessionContext() session: CurrentSession, @Query() query: unknown) {
    return this.routes.analytics(session, parseAnalyticsQuery(query));
  }

  @Get(':routeId/analytics')
  @ApiOperation({ summary: '聚合单条线路的 Worker 识别与二维码反馈' })
  routeAnalytics(
    @CurrentSessionContext() session: CurrentSession,
    @Param('routeId') routeId: unknown,
    @Query() query: unknown,
  ) {
    return this.routes.analytics(session, parseAnalyticsQuery(query), parseRouteId(routeId));
  }

  @Get()
  @ApiOperation({ summary: '读取线路运营档案' })
  list(@CurrentSessionContext() session: CurrentSession, @Query() query: unknown) {
    return this.routes.list(session, parseListRoutes(query));
  }

  @Post()
  @ApiOperation({ summary: '创建不依赖三维孔位的线路草稿' })
  create(@CurrentSessionContext() session: CurrentSession, @Body() body: unknown) {
    return this.routes.create(session, parseCreateRoute(body));
  }

  @Get(':routeId')
  @ApiOperation({ summary: '读取单条线路运营档案' })
  get(@CurrentSessionContext() session: CurrentSession, @Param('routeId') routeId: unknown) {
    return this.routes.get(session, parseRouteId(routeId));
  }

  @Patch(':routeId')
  @ApiOperation({ summary: '修改未发布的线路草稿' })
  update(
    @CurrentSessionContext() session: CurrentSession,
    @Param('routeId') routeId: unknown,
    @Body() body: unknown,
  ) {
    return this.routes.update(session, parseRouteId(routeId), parseUpdateRoute(body));
  }

  @Delete(':routeId')
  @ApiOperation({ summary: '删除已停用线路并保留历史关联' })
  remove(@CurrentSessionContext() session: CurrentSession, @Param('routeId') routeId: unknown) {
    return this.routes.remove(session, parseRouteId(routeId));
  }

  @Post(':routeId/publish')
  @ApiOperation({ summary: '发布线路并生成可重复打印的签名二维码 token' })
  publish(@CurrentSessionContext() session: CurrentSession, @Param('routeId') routeId: unknown) {
    return this.routes.publish(session, parseRouteId(routeId));
  }

  @Post(':routeId/retire')
  @ApiOperation({ summary: '停用线路并保留版本、二维码和历史反馈' })
  retire(@CurrentSessionContext() session: CurrentSession, @Param('routeId') routeId: unknown) {
    return this.routes.retire(session, parseRouteId(routeId));
  }

  @Post(':routeId/restore')
  @ApiOperation({ summary: '恢复已停用线路' })
  restore(@CurrentSessionContext() session: CurrentSession, @Param('routeId') routeId: unknown) {
    return this.routes.restore(session, parseRouteId(routeId));
  }

  @Post(':routeId/photo')
  @ApiOperation({ summary: '上传或替换线路识别照片' })
  async uploadPhoto(
    @CurrentSessionContext() session: CurrentSession,
    @Param('routeId') routeId: unknown,
    @Req() request: FastifyRequest,
  ) {
    const file = await request.file();
    if (!file) throw new BadRequestException('请选择线路照片');
    return this.photos.upload(session, parseRouteId(routeId), file);
  }

  @Get(':routeId/photo')
  @ApiOperation({ summary: '读取当前岩馆的线路照片' })
  async getPhoto(
    @CurrentSessionContext() session: CurrentSession,
    @Param('routeId') routeId: unknown,
  ) {
    const { photo, stream } = await this.photos.get(session, parseRouteId(routeId));
    return new StreamableFile(stream, {
      type: photo.contentType,
      length: photo.sizeBytes,
      disposition: 'inline',
    });
  }
}

@ApiTags('public-routes')
@Controller('public/routes')
export class PublicRouteController {
  constructor(private readonly routes: PublicRouteService) {}

  @Get(':token')
  @ApiOperation({ summary: '通过二维码读取公开线路信息，无需登录' })
  get(@Param('token') token: unknown, @Req() request: FastifyRequest) {
    return this.routes.get(parsePublicRouteToken(token), request.ip);
  }

  @Get(':token/photo')
  @ApiOperation({ summary: '通过二维码读取线路照片，无需登录' })
  async photo(@Param('token') token: unknown, @Req() request: FastifyRequest) {
    const { photo, stream } = await this.routes.getPhoto(parsePublicRouteToken(token), request.ip);
    return new StreamableFile(stream, {
      type: photo.contentType,
      length: photo.sizeBytes,
      disposition: 'inline',
    });
  }

  @Post(':token/feedback')
  @ApiOperation({ summary: '提交匿名二维码线路反馈，无需登录' })
  submit(@Param('token') token: unknown, @Req() request: FastifyRequest, @Body() body: unknown) {
    return this.routes.submit(parsePublicRouteToken(token), request.ip, parseSubmitFeedback(body));
  }
}
