import {
  Body,
  Controller,
  Get,
  HttpCode,
  Param,
  Patch,
  Post,
  Req,
  Res,
  UseGuards,
} from '@nestjs/common';
import { ApiCookieAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { CurrentSessionContext } from '../auth/current-session.decorator';
import { SessionGuard } from '../auth/session.guard';
import type { CurrentSession } from '../auth/session.service';
import type { FastifyReply, FastifyRequest } from 'fastify';
import { AppConfigService } from '../config/app-config.service';
import {
  parseAcceptInvitation,
  parseCreateInvitation,
  parseInvitationToken,
  parseUpdateMember,
} from './team.dto';
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

@ApiTags('auth')
@Controller('auth/invitations')
export class InvitationPublicController {
  constructor(
    private readonly invitations: TeamInvitationService,
    private readonly config: AppConfigService,
  ) {}

  @Get(':token')
  @ApiOperation({ summary: '查看员工邀请信息' })
  inspect(@Param('token') token: string) {
    return this.invitations.inspect(parseInvitationToken(token));
  }

  @Post(':token/accept')
  @HttpCode(200)
  @ApiOperation({ summary: '接受员工邀请并登录' })
  async accept(
    @Param('token') token: string,
    @Body() body: unknown,
    @Req() request: FastifyRequest,
    @Res({ passthrough: true }) reply: FastifyReply,
  ) {
    const result = await this.invitations.accept(
      parseInvitationToken(token),
      parseAcceptInvitation(body),
      request.ip,
    );
    const environment = this.config.values;
    reply.setCookie(environment.SESSION_COOKIE_NAME, result.token, {
      httpOnly: true,
      sameSite: 'lax',
      secure: environment.SESSION_COOKIE_SECURE,
      path: '/',
      expires: result.expiresAt,
    });
    return {
      organization: result.organization,
      role: result.role,
      expiresAt: result.expiresAt.toISOString(),
    };
  }
}
