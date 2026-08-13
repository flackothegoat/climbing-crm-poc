import { CallHandler, ExecutionContext, Injectable, Logger, NestInterceptor } from '@nestjs/common';
import type { FastifyReply, FastifyRequest } from 'fastify';
import { randomUUID } from 'node:crypto';
import { Observable } from 'rxjs';
import { finalize } from 'rxjs/operators';
import type { AuthenticatedRequest } from '../auth/current-session.decorator';
import { AppConfigService } from '../config/app-config.service';
import { RequestContextService } from './request-context.service';

export interface RequestWithCorrelationId extends FastifyRequest {
  correlationId?: string;
}

const validCorrelationId = /^[A-Za-z0-9._-]{1,64}$/;

@Injectable()
export class CorrelationIdInterceptor implements NestInterceptor {
  private readonly logger = new Logger('HttpRequest');

  constructor(
    private readonly context: RequestContextService,
    private readonly config: AppConfigService,
  ) {}

  intercept(execution: ExecutionContext, next: CallHandler): Observable<unknown> {
    const request = execution.switchToHttp().getRequest<RequestWithCorrelationId>();
    const reply = execution.switchToHttp().getResponse<FastifyReply>();
    const supplied = request.headers['x-correlation-id']?.toString();
    const correlationId = supplied && validCorrelationId.test(supplied) ? supplied : randomUUID();
    const startedAt = performance.now();
    request.correlationId = correlationId;
    reply.header('x-correlation-id', correlationId);
    return new Observable((subscriber) =>
      this.context.run(
        {
          correlationId,
          method: request.method,
          path: request.url,
          ip: request.ip,
        },
        () =>
          next
            .handle()
            .pipe(
              finalize(() => {
                if (!this.config.values.REQUEST_LOG_ENABLED) return;
                const session = (request as AuthenticatedRequest).currentSession;
                this.logger.log(
                  JSON.stringify({
                    event: 'http.request.completed',
                    correlationId,
                    method: request.method,
                    path: request.url,
                    statusCode: reply.statusCode,
                    durationMs: Math.round((performance.now() - startedAt) * 10) / 10,
                    organizationId: session?.organization.id,
                    accountId: session?.account.id,
                  }),
                );
              }),
            )
            .subscribe(subscriber),
      ),
    );
  }
}
