import { ConflictException, Injectable, Logger, UnauthorizedException } from '@nestjs/common';
import { MembershipRole } from '@prisma/client';
import bcrypt from 'bcryptjs';
import { AuditService } from '../common/audit.service';
import { AppConfigService } from '../config/app-config.service';
import { PrismaService } from '../database/prisma.service';
import { isPrismaError } from '../database/prisma-errors';
import { RateLimitService } from '../security/rate-limit.service';
import { TokenService } from '../security/token.service';
import { AUTH_POLICY } from './auth.constants';
import type { LoginInput, RegisterInput } from './auth.dto';

export interface SessionResult {
  expiresAt: Date;
  organization: { id: string; name: string };
  role: MembershipRole;
  token: string;
}

@Injectable()
export class AuthService {
  private readonly logger = new Logger(AuthService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly tokens: TokenService,
    private readonly rateLimit: RateLimitService,
    private readonly audit: AuditService,
    private readonly config: AppConfigService,
  ) {}

  async register(input: RegisterInput, clientIp = 'unknown'): Promise<SessionResult> {
    await Promise.all([
      this.rateLimit.consume('register:email', input.email, ...rateLimitArgs('register')),
      this.rateLimit.consume('register:ip', clientIp, ...rateLimitArgs('register')),
    ]);
    const session = this.createSession();
    try {
      const result = await this.createL1Admin(input, session);
      return { ...session, organization: result.organization, role: MembershipRole.L1_ADMIN };
    } catch (error) {
      if (isPrismaError(error, 'P2002')) {
        throw new ConflictException('该邮箱已注册，请直接登录');
      }
      throw error;
    }
  }

  async login(input: LoginInput, clientIp = 'unknown'): Promise<SessionResult> {
    await Promise.all([
      this.rateLimit.consume('login:email', input.email, ...rateLimitArgs('login')),
      this.rateLimit.consume(
        'login:ip',
        clientIp,
        AUTH_POLICY.loginIpRateLimit.attempts,
        AUTH_POLICY.loginIpRateLimit.windowMinutes,
      ),
    ]);
    const account = await this.prisma.account.findUnique({
      where: { email: input.email },
      include: {
        memberships: {
          where: { status: 'ACTIVE' },
          include: { organization: true },
          orderBy: { createdAt: 'asc' },
          take: 1,
        },
      },
    });
    if (
      !account ||
      account.status !== 'ACTIVE' ||
      !(await bcrypt.compare(input.password, account.passwordHash))
    ) {
      await this.recordFailedLogin(account?.id, input.email);
      throw new UnauthorizedException('邮箱或密码不正确');
    }
    const membership = account.memberships[0];
    if (!membership) throw new UnauthorizedException('账号未关联可用岩馆');
    const session = this.createSession();
    await this.prisma.$transaction(async (transaction) => {
      await transaction.authSession.create({
        data: {
          membershipId: membership.id,
          tokenHash: this.tokens.hash(session.token),
          expiresAt: session.expiresAt,
        },
      });
      await this.audit.record(
        {
          organizationId: membership.organizationId,
          actorAccountId: account.id,
          type: 'auth.login',
          outcome: 'SUCCESS',
        },
        transaction,
      );
    });
    await this.rateLimit.reset('login:email', input.email);
    return {
      ...session,
      organization: toOrganization(membership.organization),
      role: membership.role,
    };
  }

  private async recordFailedLogin(accountId: string | undefined, email: string): Promise<void> {
    try {
      await this.audit.record({
        actorAccountId: accountId,
        type: 'auth.login',
        outcome: 'FAILURE',
        metadata: { emailHash: this.tokens.hash(email) },
      });
    } catch (error) {
      this.logger.warn('登录失败审计记录未能写入', error);
    }
  }

  private createSession(): Pick<SessionResult, 'token' | 'expiresAt'> {
    const expiresAt = new Date(Date.now() + this.config.values.SESSION_TTL_HOURS * 60 * 60_000);
    return { token: this.tokens.createRawToken(), expiresAt };
  }

  private async createL1Admin(
    input: RegisterInput,
    session: Pick<SessionResult, 'token' | 'expiresAt'>,
  ) {
    const passwordHash = await bcrypt.hash(input.password, AUTH_POLICY.bcryptRounds);
    return this.prisma.$transaction(async (transaction) => {
      const account = await transaction.account.create({
        data: { email: input.email, passwordHash },
      });
      const organization = await transaction.organization.create({
        data: { name: input.organizationName },
      });
      const membership = await transaction.membership.create({
        data: {
          accountId: account.id,
          organizationId: organization.id,
          role: MembershipRole.L1_ADMIN,
        },
      });
      await transaction.authSession.create({
        data: {
          membershipId: membership.id,
          tokenHash: this.tokens.hash(session.token),
          expiresAt: session.expiresAt,
        },
      });
      await this.audit.record(
        {
          organizationId: organization.id,
          actorAccountId: account.id,
          type: 'auth.register',
          outcome: 'SUCCESS',
        },
        transaction,
      );
      return { accountId: account.id, organization: toOrganization(organization) };
    });
  }
}

function rateLimitArgs(action: 'login' | 'register'): [number, number] {
  const policy = action === 'login' ? AUTH_POLICY.loginRateLimit : AUTH_POLICY.registerRateLimit;
  return [policy.attempts, policy.windowMinutes];
}

function toOrganization(organization: { id: string; name: string }): { id: string; name: string } {
  return { id: organization.id, name: organization.name };
}
