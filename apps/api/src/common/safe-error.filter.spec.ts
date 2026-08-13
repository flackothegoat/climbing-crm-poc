import { BadRequestException, type ArgumentsHost } from '@nestjs/common';
import { describe, expect, it, vi } from 'vitest';
import { SafeErrorFilter } from './safe-error.filter';

function harness() {
  const send = vi.fn();
  const reply = { status: vi.fn().mockReturnValue({ send }) };
  const request = {
    correlationId: 'request-123',
    method: 'POST',
    url: '/api/holds/scans/scan-1/assets',
  };
  const host = {
    switchToHttp: () => ({ getRequest: () => request, getResponse: () => reply }),
  } as unknown as ArgumentsHost;
  return { host, reply, send };
}

describe('SafeErrorFilter', () => {
  it('保留 Fastify 上传过大错误的 413 状态', () => {
    const { host, reply, send } = harness();
    new SafeErrorFilter().catch({ statusCode: 413, message: 'too large' }, host);
    expect(reply.status).toHaveBeenCalledWith(413);
    expect(send).toHaveBeenCalledWith({
      code: 'PAYLOAD_TOO_LARGE',
      message: '上传文件过大',
      correlationId: 'request-123',
    });
  });

  it('验证错误数组只返回第一条安全消息', () => {
    const { host, send } = harness();
    new SafeErrorFilter().catch(
      new BadRequestException({ message: ['第一处错误', '第二处错误'] }),
      host,
    );
    expect(send).toHaveBeenCalledWith(
      expect.objectContaining({ code: 'VALIDATION_ERROR', message: '第一处错误' }),
    );
  });
});
