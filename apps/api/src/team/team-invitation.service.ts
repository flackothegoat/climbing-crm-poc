import {
  ConflictException,
  GoneException,
  Injectable,
  NotFoundException,
  UnauthorizedException,
} from '@nestjs/common';
import { InvitationStatus, MembershipRole } from '@prisma/client';
import type { Account, Organization, Prisma, StaffInvitation } from '@prisma/client';
import bcrypt from 'bcryptjs';
import type { CurrentSession } from '../auth/session.service';
import type { SessionResult } from '../auth/auth.service';
import { AuditService } from '../common/audit.service';
import { AppConfigService } from '../config/app-config.service';
import { PrismaService } from '../database/prisma.service';
import { isPrismaError } from '../database/prisma-errors';
import { TokenService } from '../security/token.service';
import { RateLimitService } from '../security/rate-limit.service';
import { AUTH_POLICY } from '../auth/auth.constants';
import type { AcceptInvitationInput, CreateInvitationInput } from './team.dto';
import { AccessControlService, Capability } from '../security/access-control.service';

type InvitationWithOrganization = StaffInvitation & { organization: Organization };

@Injectable()
export class TeamInvitationService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly tokens: TokenService,
    private readonly audit: AuditService,
    private readonly access: AccessControlService,
    private readonly config: AppConfigService,
    private readonly rateLimit: RateLimitService,
  ) {}

  async list(session: CurrentSession) {
    this.access.assert(session, Capability.TEAM_MANAGE);
    const invitations = await this.prisma.staffInvitation.findMany({
      where: { organizationId: session.organization.id },
      orderBy: { createdAt: 'desc' },
    });
    return invitations.map((invitation) => this.toSummary(invitation));
  }

  async create(session: CurrentSession, input: CreateInvitationInput) {
    this.access.assert(session, Capability.TEAM_MANAGE);
    const token = this.tokens.createRawToken();
    try {
      const invitation = await this.prisma.$transaction(async (transaction) => {
        await this.assertCanInvite(session.organization.id, input.email, transaction);
        const created = await transaction.staffInvitation.create({
          data: {
            organizationId: session.organization.id,
            email: input.email,
            tokenHash: this.tokens.hash(token),
            pendingKey: pendingKey(session.organization.id, input.email),
            invitedByAccountId: session.account.id,
            expiresAt: invitationExpiry(this.config.values.INVITATION_TTL_HOURS),
          },
        });
        await this.record(session, created.id, 'team.invitation.created', transaction);
        return created;
      });
      return {
        ...this.toSummary(invitation),
        activationUrl: activationUrl(this.config.values.WEB_ORIGIN, token),
      };
    } catch (error) {
      if (isPrismaError(error, 'P2002')) {
        throw new ConflictException('该邮箱已有待接受邀请');
      }
      throw error;
    }
  }

  async resend(session: CurrentSession, invitationId: string) {
    this.access.assert(session, Capability.TEAM_MANAGE);
    const current = await this.findForOrganization(invitationId, session.organization.id);
    if (current.status !== InvitationStatus.PENDING) {
      throw new ConflictException('只有待接受的邀请可以重新发送');
    }
    const token = this.tokens.createRawToken();
    const invitation = await this.prisma.$transaction(async (transaction) => {
      const updated = await transaction.staffInvitation.update({
        where: { id: current.id },
        data: {
          tokenHash: this.tokens.hash(token),
          expiresAt: invitationExpiry(this.config.values.INVITATION_TTL_HOURS),
        },
      });
      await this.record(session, updated.id, 'team.invitation.resent', transaction);
      return updated;
    });
    return {
      ...this.toSummary(invitation),
      activationUrl: activationUrl(this.config.values.WEB_ORIGIN, token),
    };
  }

  async revoke(session: CurrentSession, invitationId: string): Promise<void> {
    this.access.assert(session, Capability.TEAM_MANAGE);
    await this.prisma.$transaction(async (transaction) => {
      const result = await transaction.staffInvitation.updateMany({
        where: {
          id: invitationId,
          organizationId: session.organization.id,
          status: InvitationStatus.PENDING,
        },
        data: { status: InvitationStatus.REVOKED, pendingKey: null, revokedAt: new Date() },
      });
      if (!result.count) throw new NotFoundException('未找到可撤销的邀请');
      await this.record(session, invitationId, 'team.invitation.revoked', transaction);
    });
  }

  async inspect(rawToken: string) {
    const invitation = await this.findByToken(rawToken);
    return {
      email: invitation.email,
      organization: { id: invitation.organization.id, name: invitation.organization.name },
      status: invitationStatus(invitation),
      expiresAt: invitation.expiresAt.toISOString(),
    };
  }

  async accept(
    rawToken: string,
    input: AcceptInvitationInput,
    clientIp = 'unknown',
  ): Promise<SessionResult> {
    const policy = AUTH_POLICY.invitationRateLimit;
    await Promise.all([
      this.rateLimit.consume('invitation:token', rawToken, policy.attempts, policy.windowMinutes),
      this.rateLimit.consume(
        'invitation:ip',
        clientIp,
        AUTH_POLICY.invitationIpRateLimit.attempts,
        AUTH_POLICY.invitationIpRateLimit.windowMinutes,
      ),
    ]);
    const invitation = await this.findByToken(rawToken);
    this.assertAcceptable(invitation);
    const existing = await this.prisma.account.findUnique({ where: { email: invitation.email } });
    await this.assertAccountCanAccept(existing, input.password, invitation.organizationId);
    const passwordHash = existing ? existing.passwordHash : await hashPassword(input.password);
    const session = createSession(this.tokens, this.config.values.SESSION_TTL_HOURS);
    try {
      await this.persistAcceptance(invitation, existing, passwordHash, input, session);
    } catch (error) {
      if (isPrismaError(error, 'P2002')) {
        throw new ConflictException('账号或成员关系刚刚发生变化，请重新打开邀请链接');
      }
      throw error;
    }
    await this.rateLimit.reset('invitation:token', rawToken);
    return {
      ...session,
      organization: { id: invitation.organization.id, name: invitation.organization.name },
      role: MembershipRole.L2_ADMIN,
    };
  }

  private persistAcceptance(
    invitation: InvitationWithOrganization,
    existing: Account | null,
    passwordHash: string,
    input: AcceptInvitationInput,
    session: Pick<SessionResult, 'token' | 'expiresAt'>,
  ) {
    return this.prisma.$transaction(async (transaction) => {
      const claim = await transaction.staffInvitation.updateMany({
        where: {
          id: invitation.id,
          status: InvitationStatus.PENDING,
          expiresAt: { gt: new Date() },
        },
        data: { status: InvitationStatus.ACCEPTED, pendingKey: null, acceptedAt: new Date() },
      });
      if (!claim.count) throw new ConflictException('邀请状态已发生变化，请刷新后重试');
      const account =
        existing ??
        (await transaction.account.create({ data: { email: invitation.email, passwordHash } }));
      const membership = await transaction.membership.create({
        data: {
          accountId: account.id,
          organizationId: invitation.organizationId,
          role: MembershipRole.L2_ADMIN,
          displayName: input.displayName,
          jobTitle: '员工',
        },
      });
      await transaction.staffInvitation.update({
        where: { id: invitation.id },
        data: { acceptedByAccountId: account.id },
      });
      await transaction.authSession.create({
        data: {
          membershipId: membership.id,
          tokenHash: this.tokens.hash(session.token),
          expiresAt: session.expiresAt,
        },
      });
      const result = { accountId: account.id, membershipId: membership.id };
      await this.recordAcceptance(invitation, result, transaction);
      return result;
    });
  }

  private recordAcceptance(
    invitation: InvitationWithOrganization,
    result: { accountId: string; membershipId: string },
    client?: Prisma.TransactionClient,
  ): Promise<unknown> {
    return this.audit.record(
      {
        organizationId: invitation.organizationId,
        actorAccountId: result.accountId,
        type: 'team.invitation.accepted',
        outcome: 'SUCCESS',
        metadata: { invitationId: invitation.id, membershipId: result.membershipId },
      },
      client,
    );
  }

  private async assertCanInvite(
    organizationId: string,
    email: string,
    client: Pick<PrismaService, 'membership' | 'staffInvitation'> | Prisma.TransactionClient = this
      .prisma,
  ): Promise<void> {
    const membership = await client.membership.findFirst({
      where: { organizationId, account: { email } },
    });
    if (membership) throw new ConflictException('该邮箱已经是当前岩馆员工');
    const pending = await client.staffInvitation.findUnique({
      where: { pendingKey: pendingKey(organizationId, email) },
    });
    if (pending) throw new ConflictException('该邮箱已有待接受邀请');
  }

  private async findForOrganization(id: string, organizationId: string) {
    const invitation = await this.prisma.staffInvitation.findFirst({
      where: { id, organizationId },
    });
    if (!invitation) throw new NotFoundException('邀请不存在');
    return invitation;
  }

  private async findByToken(rawToken: string) {
    const invitation = await this.prisma.staffInvitation.findUnique({
      where: { tokenHash: this.tokens.hash(rawToken) },
      include: { organization: true },
    });
    if (!invitation) throw new NotFoundException('邀请链接无效');
    return invitation;
  }

  private assertAcceptable(invitation: { status: InvitationStatus; expiresAt: Date }): void {
    if (invitation.status !== InvitationStatus.PENDING) {
      throw new ConflictException('该邀请已被接受或撤销');
    }
    if (invitation.expiresAt <= new Date()) throw new GoneException('该邀请已过期');
  }

  private async assertAccountCanAccept(
    account: { id: string; passwordHash: string; status: string } | null,
    password: string,
    organizationId: string,
  ): Promise<void> {
    if (!account) return;
    if (account.status !== 'ACTIVE' || !(await bcrypt.compare(password, account.passwordHash))) {
      throw new UnauthorizedException('该邮箱已注册，请输入原账号密码');
    }
    const membership = await this.prisma.membership.findUnique({
      where: { accountId_organizationId: { accountId: account.id, organizationId } },
    });
    if (membership) throw new ConflictException('该账号已经加入当前岩馆');
  }

  private toSummary(invitation: {
    id: string;
    email: string;
    status: InvitationStatus;
    expiresAt: Date;
    createdAt: Date;
  }) {
    return {
      id: invitation.id,
      email: invitation.email,
      status: invitationStatus(invitation),
      expiresAt: invitation.expiresAt.toISOString(),
      createdAt: invitation.createdAt.toISOString(),
    };
  }

  private record(
    session: CurrentSession,
    invitationId: string,
    type: string,
    client?: Prisma.TransactionClient,
  ): Promise<unknown> {
    return this.audit.record(
      {
        organizationId: session.organization.id,
        actorAccountId: session.account.id,
        type,
        outcome: 'SUCCESS',
        metadata: { invitationId },
      },
      client,
    );
  }
}

function pendingKey(organizationId: string, email: string): string {
  return `${organizationId}:${email}`;
}

function invitationExpiry(ttlHours: number): Date {
  return new Date(Date.now() + ttlHours * 60 * 60_000);
}

function invitationStatus(invitation: { status: InvitationStatus; expiresAt: Date }): string {
  if (invitation.status === InvitationStatus.PENDING && invitation.expiresAt <= new Date()) {
    return 'EXPIRED';
  }
  return invitation.status;
}

function activationUrl(webOrigin: string, token: string): string {
  return `${webOrigin}/invite/${encodeURIComponent(token)}`;
}

function createSession(
  tokens: TokenService,
  ttlHours: number,
): Pick<SessionResult, 'token' | 'expiresAt'> {
  const expiresAt = new Date(Date.now() + ttlHours * 60 * 60_000);
  return { token: tokens.createRawToken(), expiresAt };
}

function hashPassword(password: string): Promise<string> {
  return bcrypt.hash(password, AUTH_POLICY.bcryptRounds);
}
