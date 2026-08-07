import { RequestMethod } from '@nestjs/common';
import { METHOD_METADATA, PATH_METADATA } from '@nestjs/common/constants';
import { describe, expect, it } from 'vitest';
import { HoldController } from './holds/hold.controller';
import { CORS_ALLOWED_METHODS } from './main';

describe('API CORS', () => {
  it('允许前端发起永久删除请求', () => {
    expect(CORS_ALLOWED_METHODS).toContain('POST');
  });

  it('注册岩点档案永久删除路由', () => {
    const handler = HoldController.prototype.permanentlyDeleteSpecification;
    expect(Reflect.getMetadata(PATH_METADATA, handler)).toBe(
      'specifications/:specificationId/permanent-delete',
    );
    expect(Reflect.getMetadata(METHOD_METADATA, handler)).toBe(RequestMethod.POST);
  });
});
