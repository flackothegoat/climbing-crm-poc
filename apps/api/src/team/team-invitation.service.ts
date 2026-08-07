import {
  ConflictException,
  GoneException,
  Injectable,
  NotFoundException,
  UnauthorizedException,
} from '@nestjs/common';
import { InvitationStatus, MembershipRole } from '@prisma/client';
import type { Account, Organization, StaffInvitation } from '@prisma/client';
import bcrypt from 'bcryptjs';
import type { CurrentSession } from '../auth/session.service';
import type { SessionResult } from '../auth/auth.service';
import { AuditService } from '../common/audit.service';
import { readEnvironment } from '../config/environment';
import { PrismaService } from '../database/prisma.service';
import { TokenService } from '../security/token.service';
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
    await this.assertCanInvite(session.organization.id, input.email);
    const token = this.tokens.createRawToken();
    const invitation = await this.prisma.staffInvitation.create({
      data: {
        organizationId: session.organization.id,
        email: input.email,
        tokenHash: this.tokens.hash(token),
        pendingKey: pendingKey(session.organization.id, input.email),
        invitedByAccountId: session.account.id,
        expiresAt: invitationExpiry(),
      },
    });
    await this.record(session, invitation.id, 'team.invitation.created');
    return { ...this.toSummary(invitation), activationUrl: activationUrl(token) };
  }

  async resend(session: CurrentSession, invitationId: string) {
    this.access.assert(session, Capability.TEAM_MANAGE);
    const current = await this.findForOrganization(invitationId, session.organization.id);
    if (current.status !== InvitationStatus.PENDING) {
      throw new ConflictException('只有待接受的邀请可以重新发送');
    }
    const token = this.tokens.createRawToken();
    const invitation = await this.prisma.staffInvitation.update({
      where: { id: current.id },
      data: {
        tokenHash: this.tokens.hash(token),
        expiresAt: invitationExpiry(),
      },
    });
    await this.record(session, invitation.id, 'team.invitation.resent');
    return { ...this.toSummary(invitation), activationUrl: activationUrl(token) };
  }

  async revoke(session: CurrentSession, invitationId: string): Promise<void> {
    this.access.assert(session, Capability.TEAM_MANAGE);
    const result = await this.prisma.staffInvitation.updateMany({
      where: {
        id: invitationId,
        organizationId: session.organization.id,
        status: InvitationStatus.PENDING,
      },
      data: { status: InvitationStatus.REVOKED, pendingKey: null, revokedAt: new Date() },
    });
    if (!result.count) throw new NotFoundException('未找到可撤销的邀请');
    await this.record(session, invitationId, 'team.invitation.revoked');
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

  async accept(rawToken: string, input: AcceptInvitationInput): Promise<SessionResult> {
    const invitation = await this.findByToken(rawToken);
    this.assertAcceptable(invitation);
    const existing = await this.prisma.account.findUnique({ where: { email: invitation.email } });
    await this.assertAccountCanAccept(existing, input.password, invitation.organizationId);
    const passwordHash = existing ? existing.passwordHash : await hashPassword(input.password);
    const session = createSession(this.tokens);
    const result = await this.persistAcceptance(invitation, existing, passwordHash, input, session);
    await this.recordAcceptance(invitation, result);
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
          accountId: account.id,
          membershipId: membership.id,
          tokenHash: this.tokens.hash(session.token),
          expiresAt: session.expiresAt,
        },
      });
      return { accountId: account.id, membershipId: membership.id };
    });
  }

  private recordAcceptance(
    invitation: InvitationWithOrganization,
    result: { accountId: string; membershipId: string },
  ): Promise<unknown> {
    return this.audit.record({
      organizationId: invitation.organizationId,
      actorAccountId: result.accountId,
      type: 'team.invitation.accepted',
      outcome: 'SUCCESS',
      metadata: { invitationId: invitation.id, membershipId: result.membershipId },
    });
  }

  private async assertCanInvite(organizationId: string, email: string): Promise<void> {
    const membership = await this.prisma.membership.findFirst({
      where: { organizationId, account: { email } },
    });
    if (membership) throw new ConflictException('该邮箱已经是当前岩馆员工');
    const pending = await this.prisma.staffInvitation.findUnique({
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

  private record(session: CurrentSession, invitationId: string, type: string): Promise<unknown> {
    return this.audit.record({
      organizationId: session.organization.id,
      actorAccountId: session.account.id,
      type,
      outcome: 'SUCCESS',
      metadata: { invitationId },
    });
  }
}

function pendingKey(organizationId: string, email: string): string {
  return `${organizationId}:${email}`;
}

function invitationExpiry(): Date {
  return new Date(Date.now() + readEnvironment().INVITATION_TTL_HOURS * 60 * 60_000);
}

function invitationStatus(invitation: { status: InvitationStatus; expiresAt: Date }): string {
  if (invitation.status === InvitationStatus.PENDING && invitation.expiresAt <= new Date()) {
    return 'EXPIRED';
  }
  return invitation.status;
}

function activationUrl(token: string): string {
  return `${readEnvironment().WEB_ORIGIN}/invite/${encodeURIComponent(token)}`;
}

function createSession(tokens: TokenService): Pick<SessionResult, 'token' | 'expiresAt'> {
  const expiresAt = new Date(Date.now() + readEnvironment().SESSION_TTL_HOURS * 60 * 60_000);
  return { token: tokens.createRawToken(), expiresAt };
}

function hashPassword(password: string): Promise<string> {
  return bcrypt.hash(password, AUTH_POLICY.bcryptRounds);
}
