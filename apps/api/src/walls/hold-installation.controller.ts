import { Body, Controller, HttpCode, Param, Post, UseGuards } from '@nestjs/common';
import { ApiCookieAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { CurrentSessionContext } from '../auth/current-session.decorator';
import { SessionGuard } from '../auth/session.guard';
import type { CurrentSession } from '../auth/session.service';
import { parseInstallHold, parseRemoveHold } from './hold-installation.dto';
import { HoldInstallationService } from './hold-installation.service';

@ApiTags('hold-installations')
@ApiCookieAuth()
@UseGuards(SessionGuard)
@Controller('hold-installations')
export class HoldInstallationController {
  constructor(private readonly installations: HoldInstallationService) {}

  @Post()
  @ApiOperation({ summary: '原子创建岩点安装记录并把库存转入已安装' })
  install(@CurrentSessionContext() session: CurrentSession, @Body() body: unknown) {
    return this.installations.install(session, parseInstallHold(body));
  }

  @Post(':installationId/remove')
  @HttpCode(200)
  @ApiOperation({ summary: '原子拆除岩点并把库存转回仓库或维修' })
  remove(
    @CurrentSessionContext() session: CurrentSession,
    @Param('installationId') installationId: string,
    @Body() body: unknown,
  ) {
    return this.installations.remove(session, installationId, parseRemoveHold(body));
  }
}
