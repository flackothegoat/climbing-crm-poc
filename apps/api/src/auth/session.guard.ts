import { CanActivate, ExecutionContext, Injectable, UnauthorizedException } from '@nestjs/common';
import type { FastifyRequest } from 'fastify';
import { AppConfigService } from '../config/app-config.service';
import type { AuthenticatedRequest } from './current-session.decorator';
import { SessionService } from './session.service';

interface RequestWithCookies extends FastifyRequest {
  cookies: Record<string, string | undefined>;
}

@Injectable()
export class SessionGuard implements CanActivate {
  constructor(
    private readonly sessions: SessionService,
    private readonly config: AppConfigService,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest<RequestWithCookies>();
    const token = request.cookies[this.config.values.SESSION_COOKIE_NAME];
    if (!token) throw new UnauthorizedException('请先登录');
    (request as AuthenticatedRequest).currentSession = await this.sessions.getCurrent(token);
    return true;
  }
}
