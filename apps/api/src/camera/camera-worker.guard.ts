import { createHash, timingSafeEqual } from 'node:crypto';
import { CanActivate, ExecutionContext, Injectable, UnauthorizedException } from '@nestjs/common';
import type { FastifyRequest } from 'fastify';
import { AppConfigService } from '../config/app-config.service';

@Injectable()
export class CameraWorkerGuard implements CanActivate {
  constructor(private readonly config: AppConfigService) {}

  canActivate(context: ExecutionContext): boolean {
    const request = context.switchToHttp().getRequest<FastifyRequest>();
    const supplied = request.headers['x-camera-worker-token'];
    const token = Array.isArray(supplied) ? supplied[0] : supplied;
    const expected = this.config.values.CAMERA_WORKER_TOKEN;
    if (!token || !expected || !secureEqual(token, expected)) {
      throw new UnauthorizedException('摄像头 Worker 凭据无效或尚未配置');
    }
    return true;
  }
}

function secureEqual(left: string, right: string): boolean {
  const leftHash = createHash('sha256').update(left).digest();
  const rightHash = createHash('sha256').update(right).digest();
  return timingSafeEqual(leftHash, rightHash);
}
