import { Body, Controller, Get, Param, Post, Query, UseGuards } from '@nestjs/common';
import { ApiCookieAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { CurrentSessionContext } from '../auth/current-session.decorator';
import { SessionGuard } from '../auth/session.guard';
import type { CurrentSession } from '../auth/session.service';
import {
  parseCreateRfidInventorySession,
  parseIngestRfidInventoryReads,
  parseListRfidInventorySessions,
  parseTransitionRfidInventorySession,
} from './rfid-inventory.dto';
import { RfidInventoryService } from './rfid-inventory.service';

@ApiTags('hold-rfid-inventory')
@ApiCookieAuth()
@UseGuards(SessionGuard)
@Controller('holds/rfid-inventory-sessions')
export class RfidInventoryController {
  constructor(private readonly inventory: RfidInventoryService) {}

  @Get()
  @ApiOperation({ summary: '读取当前岩馆最近的 RFID 盘点会话' })
  list(@CurrentSessionContext() session: CurrentSession, @Query() query: unknown) {
    return this.inventory.list(session, parseListRfidInventorySessions(query));
  }

  @Post()
  @ApiOperation({ summary: '创建 RFID 盘点会话并固化应到标签快照' })
  create(@CurrentSessionContext() session: CurrentSession, @Body() body: unknown) {
    return this.inventory.create(session, parseCreateRfidInventorySession(body));
  }

  @Get(':sessionId')
  @ApiOperation({ summary: '读取 RFID 盘点差异和观测明细' })
  get(@CurrentSessionContext() session: CurrentSession, @Param('sessionId') sessionId: string) {
    return this.inventory.get(session, sessionId);
  }

  @Post(':sessionId/reads')
  @ApiOperation({ summary: '幂等接收一批 RFID EPC 读取结果' })
  ingest(
    @CurrentSessionContext() session: CurrentSession,
    @Param('sessionId') sessionId: string,
    @Body() body: unknown,
  ) {
    return this.inventory.ingest(session, sessionId, parseIngestRfidInventoryReads(body));
  }

  @Post(':sessionId/complete')
  @ApiOperation({ summary: '完成 RFID 盘点，记录已核验实物事件' })
  complete(
    @CurrentSessionContext() session: CurrentSession,
    @Param('sessionId') sessionId: string,
    @Body() body: unknown,
  ) {
    return this.inventory.complete(session, sessionId, parseTransitionRfidInventorySession(body));
  }

  @Post(':sessionId/cancel')
  @ApiOperation({ summary: '取消 RFID 盘点但保留已读数据供审计' })
  cancel(
    @CurrentSessionContext() session: CurrentSession,
    @Param('sessionId') sessionId: string,
    @Body() body: unknown,
  ) {
    return this.inventory.cancel(session, sessionId, parseTransitionRfidInventorySession(body));
  }
}
