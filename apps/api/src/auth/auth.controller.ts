import {
  Body,
  Controller,
  Get,
  HttpCode,
  Post,
  Req,
  Res,
  UnauthorizedException,
} from '@nestjs/common';
import { ApiBody, ApiOperation, ApiTags } from '@nestjs/swagger';
import type { FastifyReply, FastifyRequest } from 'fastify';
import { AppConfigService } from '../config/app-config.service';
import { parseLoginInput, parseRegisterInput } from './auth.dto';
import { AuthService, type SessionResult } from './auth.service';
import { SessionService } from './session.service';

interface CookieRequest extends FastifyRequest {
  cookies: Record<string, string | undefined>;
}

@ApiTags('auth')
@Controller('auth')
export class AuthController {
  constructor(
    private readonly auth: AuthService,
    private readonly sessions: SessionService,
    private readonly config: AppConfigService,
  ) {}

  @Post('register')
  @ApiOperation({ summary: '创建岩馆工作区及其 L1 管理员' })
  @ApiBody({
    schema: {
      example: {
        email: 'owner@example.com',
        password: 'a-secure-password',
        organizationName: 'Peak CRM',
      },
    },
  })
  async register(
    @Body() body: unknown,
    @Req() request: FastifyRequest,
    @Res({ passthrough: true }) reply: FastifyReply,
  ) {
    return this.respondWithSession(
      await this.auth.register(parseRegisterInput(body), request.ip),
      reply,
    );
  }

  @Post('login')
  @HttpCode(200)
  @ApiOperation({ summary: '使用邮箱和密码登录' })
  @ApiBody({ schema: { example: { email: 'owner@example.com', password: 'a-secure-password' } } })
  async login(
    @Body() body: unknown,
    @Req() request: FastifyRequest,
    @Res({ passthrough: true }) reply: FastifyReply,
  ) {
    return this.respondWithSession(await this.auth.login(parseLoginInput(body), request.ip), reply);
  }

  @Get('session')
  @ApiOperation({ summary: '获取当前 CRM 会话' })
  async getSession(@Req() request: CookieRequest) {
    const session = await this.sessions.getCurrent(this.readSessionToken(request));
    return {
      account: session.account,
      membership: session.membership,
      organization: session.organization,
      role: session.role,
      expiresAt: session.expiresAt.toISOString(),
    };
  }

  @Post('logout')
  @HttpCode(204)
  @ApiOperation({ summary: '退出当前 CRM 会话' })
  async logout(
    @Req() request: CookieRequest,
    @Res({ passthrough: true }) reply: FastifyReply,
  ): Promise<void> {
    const environment = this.config.values;
    await this.sessions.invalidate(this.readSessionToken(request));
    reply.clearCookie(environment.SESSION_COOKIE_NAME, { path: '/' });
  }

  respondWithSession(result: SessionResult, reply: FastifyReply) {
    const env = this.config.values;
    reply.setCookie(env.SESSION_COOKIE_NAME, result.token, {
      httpOnly: true,
      sameSite: 'lax',
      secure: env.SESSION_COOKIE_SECURE,
      path: '/',
      expires: result.expiresAt,
    });
    return {
      organization: result.organization,
      role: result.role,
      expiresAt: result.expiresAt.toISOString(),
    };
  }

  private readSessionToken(request: CookieRequest): string {
    const token = request.cookies[this.config.values.SESSION_COOKIE_NAME];
    if (!token) throw new UnauthorizedException('请先登录');
    return token;
  }
}
