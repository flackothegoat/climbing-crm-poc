import {
  ArgumentsHost,
  Catch,
  ExceptionFilter,
  HttpException,
  HttpStatus,
  Logger,
} from '@nestjs/common';
import type { FastifyReply } from 'fastify';
import type { RequestWithCorrelationId } from './correlation-id.interceptor';

const safeCodes: Record<number, string> = {
  [HttpStatus.BAD_REQUEST]: 'VALIDATION_ERROR',
  [HttpStatus.UNAUTHORIZED]: 'UNAUTHENTICATED',
  [HttpStatus.FORBIDDEN]: 'FORBIDDEN',
  [HttpStatus.NOT_FOUND]: 'NOT_FOUND',
  [HttpStatus.CONFLICT]: 'CONFLICT',
  [HttpStatus.GONE]: 'EXPIRED',
  [HttpStatus.TOO_MANY_REQUESTS]: 'RATE_LIMITED',
};

@Catch()
export class SafeErrorFilter implements ExceptionFilter {
  private readonly logger = new Logger(SafeErrorFilter.name);

  catch(exception: unknown, host: ArgumentsHost): void {
    const context = host.switchToHttp();
    const request = context.getRequest<RequestWithCorrelationId>();
    const reply = context.getResponse<FastifyReply>();
    const status =
      exception instanceof HttpException ? exception.getStatus() : HttpStatus.INTERNAL_SERVER_ERROR;
    const message = this.getMessage(exception);

    if (!(exception instanceof HttpException)) {
      this.logger.error(
        'Unhandled request error',
        exception instanceof Error ? exception.stack : undefined,
      );
    }

    reply.status(status).send({
      code: safeCodes[status] ?? 'INTERNAL_ERROR',
      message,
      correlationId: request.correlationId ?? 'unavailable',
    });
  }

  private getMessage(exception: unknown): string {
    if (!(exception instanceof HttpException)) return '请求未能完成，请稍后重试';
    const response = exception.getResponse();
    if (typeof response === 'string') return response;
    const message = 'message' in response ? response.message : undefined;
    return typeof message === 'string' ? message : '请求参数不符合要求';
  }
}
