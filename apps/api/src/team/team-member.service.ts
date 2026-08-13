import { ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { MembershipRole, MembershipStatus } from '@prisma/client';
import type { CurrentSession } from '../auth/session.service';
import { AuditService } from '../common/audit.service';
import { PrismaService } from '../database/prisma.service';
import { AccessControlService, Capability } from '../security/access-control.service';
import type { UpdateMemberInput } from './team.dto';

@Injectable()
export class TeamMemberService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly access: AccessControlService,
  ) {}

  async list(session: CurrentSession) {
    this.access.assert(session, Capability.TEAM_READ);
    const members = await this.prisma.membership.findMany({
      where: { organizationId: session.organization.id },
      include: {
        account: { select: { email: true } },
        sessions: { orderBy: { createdAt: 'desc' }, take: 1, select: { createdAt: true } },
      },
      orderBy: [{ role: 'asc' }, { createdAt: 'asc' }],
    });
    const canManage = session.role === MembershipRole.L1_ADMIN;
    return members.map((member) => ({
      id: member.id,
      displayName: member.displayName ?? fallbackName(member.account.email),
      email: canManage || member.id === session.membership.id ? member.account.email : null,
      role: member.role,
      status: member.status,
      jobTitle: member.jobTitle,
      responsibility: member.responsibility,
      joinedAt: member.createdAt.toISOString(),
      lastActiveAt: canManage ? (member.sessions[0]?.createdAt.toISOString() ?? null) : null,
      isCurrent: member.id === session.membership.id,
    }));
  }

  async update(session: CurrentSession, membershipId: string, input: UpdateMemberInput) {
    this.access.assert(session, Capability.TEAM_MANAGE);
    const member = await this.prisma.membership.findFirst({
      where: { id: membershipId, organizationId: session.organization.id },
    });
    if (!member) throw new NotFoundException('员工不存在');
    this.assertStatusChangeAllowed(member.role, input.status);
    const updated = await this.prisma.$transaction(async (transaction) => {
      const result = await transaction.membership.update({
        where: { id: membershipId },
        data: input,
      });
      if (input.status === MembershipStatus.DISABLED && member.status !== input.status) {
        await transaction.authSession.updateMany({
          where: { membershipId, invalidatedAt: null },
          data: { invalidatedAt: new Date() },
        });
      }
      await this.audit.record(
        {
          organizationId: session.organization.id,
          actorAccountId: session.account.id,
          type: 'team.member.updated',
          outcome: 'SUCCESS',
          metadata: { membershipId, changedFields: Object.keys(input) },
        },
        transaction,
      );
      return result;
    });
    return updated;
  }

  private assertStatusChangeAllowed(
    role: MembershipRole,
    status: MembershipStatus | undefined,
  ): void {
    if (role === MembershipRole.L1_ADMIN && status === MembershipStatus.DISABLED) {
      throw new ForbiddenException('L1 管理员不能被停用');
    }
  }
}

function fallbackName(email: string): string {
  return email.slice(0, email.indexOf('@')) || '未命名员工';
}
