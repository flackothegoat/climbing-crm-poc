import { createParamDecorator, ExecutionContext } from '@nestjs/common';
import type { FastifyRequest } from 'fastify';
import type { CurrentSession } from './session.service';

export interface AuthenticatedRequest extends FastifyRequest {
  currentSession: CurrentSession;
}

export const CurrentSessionContext = createParamDecorator(
  (_data: unknown, context: ExecutionContext): CurrentSession =>
    context.switchToHttp().getRequest<AuthenticatedRequest>().currentSession,
);
