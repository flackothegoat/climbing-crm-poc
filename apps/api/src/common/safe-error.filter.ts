import {
  ArgumentsHost,
  Catch,
  ExceptionFilter,
  HttpException,
  HttpStatus,
  Logger,
} from '@nestjs/common';
import type { FastifyReply } from 'fastify';
import { isPrismaError } from '../database/prisma-errors';
import type { AuthenticatedRequest } from '../auth/current-session.decorator';
import type { RequestWithCorrelationId } from './correlation-id.interceptor';

const safeCodes: Record<number, string> = {
  [HttpStatus.BAD_REQUEST]: 'VALIDATION_ERROR',
  [HttpStatus.UNAUTHORIZED]: 'UNAUTHENTICATED',
  [HttpStatus.FORBIDDEN]: 'FORBIDDEN',
  [HttpStatus.NOT_FOUND]: 'NOT_FOUND',
  [HttpStatus.METHOD_NOT_ALLOWED]: 'METHOD_NOT_ALLOWED',
  [HttpStatus.CONFLICT]: 'CONFLICT',
  [HttpStatus.GONE]: 'EXPIRED',
  [HttpStatus.PAYLOAD_TOO_LARGE]: 'PAYLOAD_TOO_LARGE',
  [HttpStatus.UNSUPPORTED_MEDIA_TYPE]: 'UNSUPPORTED_MEDIA_TYPE',
  [HttpStatus.TOO_MANY_REQUESTS]: 'RATE_LIMITED',
  [HttpStatus.SERVICE_UNAVAILABLE]: 'SERVICE_UNAVAILABLE',
};

const safeDefaultMessages: Record<number, string> = {
  [HttpStatus.PAYLOAD_TOO_LARGE]: '上传文件过大',
  [HttpStatus.UNSUPPORTED_MEDIA_TYPE]: '不支持的文件或请求格式',
  [HttpStatus.SERVICE_UNAVAILABLE]: '依赖服务暂时不可用，请稍后重试',
};

@Catch()
export class SafeErrorFilter implements ExceptionFilter {
  private readonly logger = new Logger(SafeErrorFilter.name);

  catch(exception: unknown, host: ArgumentsHost): void {
    const context = host.switchToHttp();
    const request = context.getRequest<RequestWithCorrelationId & AuthenticatedRequest>();
    const reply = context.getResponse<FastifyReply>();
    const status = errorStatus(exception);
    const message = errorMessage(exception, status);
    const correlationId = request.correlationId ?? 'unavailable';

    if (status >= 500) {
      this.logger.error(
        JSON.stringify({
          event: 'http.request.failed',
          correlationId,
          method: request.method,
          path: request.url,
          statusCode: status,
          organizationId: request.currentSession?.organization.id,
          accountId: request.currentSession?.account.id,
          errorName: exception instanceof Error ? exception.name : typeof exception,
          errorMessage: exception instanceof Error ? exception.message : undefined,
          stack: exception instanceof Error ? exception.stack : undefined,
        }),
      );
    }

    reply.status(status).send({
      code: safeCodes[status] ?? (status >= 500 ? 'INTERNAL_ERROR' : 'REQUEST_FAILED'),
      message,
      correlationId,
    });
  }
}

function errorStatus(exception: unknown): number {
  if (exception instanceof HttpException) return exception.getStatus();
  if (isPrismaError(exception, 'P2002') || isPrismaError(exception, 'P2003')) {
    return HttpStatus.CONFLICT;
  }
  if (isPrismaError(exception, 'P2025')) return HttpStatus.NOT_FOUND;
  if (isStatusError(exception)) return normalizeStatus(exception.statusCode);
  return HttpStatus.INTERNAL_SERVER_ERROR;
}

function errorMessage(exception: unknown, status: number): string {
  if (exception instanceof HttpException) {
    const response = exception.getResponse();
    if (typeof response === 'string') return response;
    const message = 'message' in response ? response.message : undefined;
    if (typeof message === 'string') return message;
    if (Array.isArray(message) && typeof message[0] === 'string') return message[0];
  }
  if (isPrismaError(exception, 'P2002')) return '记录已经存在，请刷新后重试';
  if (isPrismaError(exception, 'P2003')) return '记录仍被其他数据引用，无法完成操作';
  if (isPrismaError(exception, 'P2025')) return '记录不存在或已被修改';
  return safeDefaultMessages[status] ?? '请求未能完成，请稍后重试';
}

function isStatusError(error: unknown): error is { statusCode: number } {
  return (
    typeof error === 'object' &&
    error !== null &&
    'statusCode' in error &&
    typeof error.statusCode === 'number'
  );
}

function normalizeStatus(status: number): number {
  return status >= 400 && status <= 599 ? status : HttpStatus.INTERNAL_SERVER_ERROR;
}
