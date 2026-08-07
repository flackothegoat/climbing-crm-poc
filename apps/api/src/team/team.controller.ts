import { Body, Controller, Get, HttpCode, Param, Patch, Post, UseGuards } from '@nestjs/common';
import { ApiCookieAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { CurrentSessionContext } from '../auth/current-session.decorator';
import { SessionGuard } from '../auth/session.guard';
import type { CurrentSession } from '../auth/session.service';
import { parseCreateInvitation, parseUpdateMember } from './team.dto';
import { TeamInvitationService } from './team-invitation.service';
import { TeamMemberService } from './team-member.service';

@ApiTags('team')
@ApiCookieAuth()
@UseGuards(SessionGuard)
@Controller('team')
export class TeamController {
  constructor(
    private readonly members: TeamMemberService,
    private readonly invitations: TeamInvitationService,
  ) {}

  @Get('members')
  @ApiOperation({ summary: '获取当前岩馆员工目录' })
  listMembers(@CurrentSessionContext() session: CurrentSession) {
    return this.members.list(session);
  }

  @Patch('members/:membershipId')
  @ApiOperation({ summary: '修改员工资料或在职状态' })
  updateMember(
    @CurrentSessionContext() session: CurrentSession,
    @Param('membershipId') membershipId: string,
    @Body() body: unknown,
  ) {
    return this.members.update(session, membershipId, parseUpdateMember(body));
  }

  @Get('invitations')
  @ApiOperation({ summary: '获取当前岩馆邀请记录' })
  listInvitations(@CurrentSessionContext() session: CurrentSession) {
    return this.invitations.list(session);
  }

  @Post('invitations')
  @ApiOperation({ summary: '邀请一名 L2 员工' })
  createInvitation(@CurrentSessionContext() session: CurrentSession, @Body() body: unknown) {
    return this.invitations.create(session, parseCreateInvitation(body));
  }

  @Post('invitations/:invitationId/resend')
  @HttpCode(200)
  @ApiOperation({ summary: '刷新并重新生成邀请链接' })
  resendInvitation(
    @CurrentSessionContext() session: CurrentSession,
    @Param('invitationId') invitationId: string,
  ) {
    return this.invitations.resend(session, invitationId);
  }

  @Post('invitations/:invitationId/revoke')
  @HttpCode(204)
  @ApiOperation({ summary: '撤销待接受邀请' })
  revokeInvitation(
    @CurrentSessionContext() session: CurrentSession,
    @Param('invitationId') invitationId: string,
  ) {
    return this.invitations.revoke(session, invitationId);
  }
}
