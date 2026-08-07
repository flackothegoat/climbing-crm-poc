import { Injectable } from '@nestjs/common';
import { createHash, randomBytes } from 'node:crypto';

@Injectable()
export class TokenService {
  createRawToken(): string {
    return randomBytes(32).toString('base64url');
  }

  hash(value: string): string {
    return createHash('sha256').update(value).digest('hex');
  }
}
