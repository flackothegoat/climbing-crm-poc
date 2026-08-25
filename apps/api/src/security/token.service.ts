import { Injectable } from '@nestjs/common';
import { createHash, createHmac, randomBytes, timingSafeEqual } from 'node:crypto';
import { AppConfigService } from '../config/app-config.service';

@Injectable()
export class TokenService {
  constructor(private readonly config: AppConfigService) {}

  createRawToken(): string {
    return randomBytes(32).toString('base64url');
  }

  hash(value: string): string {
    return createHash('sha256').update(value).digest('hex');
  }

  issuePublicRouteToken(publicLinkId: string): string {
    return `${publicLinkId}.${this.publicLinkSignature(publicLinkId)}`;
  }

  parsePublicRouteToken(token: string): string | null {
    const separator = token.indexOf('.');
    if (separator < 1 || separator !== token.lastIndexOf('.')) return null;
    const publicLinkId = token.slice(0, separator);
    const supplied = token.slice(separator + 1);
    if (!/^[A-Za-z0-9_-]{10,64}$/.test(publicLinkId) || !/^[A-Za-z0-9_-]{43}$/.test(supplied)) {
      return null;
    }
    const expected = this.publicLinkSignature(publicLinkId);
    const suppliedBytes = Buffer.from(supplied);
    const expectedBytes = Buffer.from(expected);
    return suppliedBytes.length === expectedBytes.length &&
      timingSafeEqual(suppliedBytes, expectedBytes)
      ? publicLinkId
      : null;
  }

  private publicLinkSignature(publicLinkId: string): string {
    return createHmac('sha256', this.config.values.PUBLIC_LINK_SIGNING_KEY)
      .update(`route-public-link:${publicLinkId}`)
      .digest('base64url');
  }
}
