import { Injectable, UnauthorizedException } from '@nestjs/common';
import type { MembershipRole } from '@prisma/client';
import { PrismaService } from '../database/prisma.service';
import { TokenService } from '../security/token.service';

export interface CurrentSession {
  account: { id: string; email: string };
  membership: { id: string; displayName: string | null };
  organization: { id: string; name: string };
  role: MembershipRole;
  expiresAt: Date;
}

@Injectable()
export class SessionService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly tokens: TokenService,
  ) {}

  async getCurrent(rawToken: string): Promise<CurrentSession> {
    const session = await this.prisma.authSession.findFirst({
      where: {
        tokenHash: this.tokens.hash(rawToken),
        invalidatedAt: null,
        expiresAt: { gt: new Date() },
        membership: { status: 'ACTIVE', account: { status: 'ACTIVE' } },
      },
      include: {
        membership: { include: { account: true, organization: true } },
      },
    });
    if (!session) throw new UnauthorizedException('登录状态已失效，请重新登录');
    return {
      account: {
        id: session.membership.account.id,
        email: session.membership.account.email,
      },
      membership: { id: session.membership.id, displayName: session.membership.displayName },
      organization: {
        id: session.membership.organization.id,
        name: session.membership.organization.name,
      },
      role: session.membership.role,
      expiresAt: session.expiresAt,
    };
  }

  async invalidate(rawToken: string): Promise<void> {
    await this.prisma.authSession.updateMany({
      where: { tokenHash: this.tokens.hash(rawToken), invalidatedAt: null },
      data: { invalidatedAt: new Date() },
    });
  }
}
