import { CallHandler, ExecutionContext, Injectable, NestInterceptor } from '@nestjs/common';
import type { FastifyReply, FastifyRequest } from 'fastify';
import { randomUUID } from 'node:crypto';
import { Observable } from 'rxjs';

export interface RequestWithCorrelationId extends FastifyRequest {
  correlationId?: string;
}

@Injectable()
export class CorrelationIdInterceptor implements NestInterceptor {
  intercept(context: ExecutionContext, next: CallHandler): Observable<unknown> {
    const request = context.switchToHttp().getRequest<RequestWithCorrelationId>();
    const reply = context.switchToHttp().getResponse<FastifyReply>();
    request.correlationId = request.headers['x-correlation-id']?.toString() ?? randomUUID();
    reply.header('x-correlation-id', request.correlationId);
    return next.handle();
  }
}
