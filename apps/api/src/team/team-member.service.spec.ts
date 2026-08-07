import { ForbiddenException } from '@nestjs/common';
import { MembershipRole, MembershipStatus } from '@prisma/client';
import { describe, expect, it, vi } from 'vitest';
import type { CurrentSession } from '../auth/session.service';
import type { AuditService } from '../common/audit.service';
import type { PrismaService } from '../database/prisma.service';
import { AccessControlService } from '../security/access-control.service';
import { TeamMemberService } from './team-member.service';

const currentSession: CurrentSession = {
  account: { id: 'owner-1', email: 'owner@example.com' },
  membership: { id: 'owner-membership', displayName: '老板' },
  organization: { id: 'org-1', name: '测试岩馆' },
  role: MembershipRole.L1_ADMIN,
  expiresAt: new Date(),
};

function createSubject(member: { id: string; role: MembershipRole; status: MembershipStatus }) {
  const update = vi.fn().mockResolvedValue({ ...member, status: MembershipStatus.DISABLED });
  const updateMany = vi.fn().mockResolvedValue({ count: 1 });
  const transaction = { membership: { update }, authSession: { updateMany } };
  const prisma = {
    membership: { findFirst: vi.fn().mockResolvedValue(member) },
    $transaction: vi.fn(async (callback) => callback(transaction)),
  } as unknown as PrismaService;
  const audit = { record: vi.fn().mockResolvedValue({}) } as unknown as AuditService;
  return {
    service: new TeamMemberService(prisma, audit, new AccessControlService()),
    updateMany,
  };
}

describe('TeamMemberService', () => {
  it('停用 L2 时使该成员全部会话失效', async () => {
    const { service, updateMany } = createSubject({
      id: 'staff-membership',
      role: MembershipRole.L2_ADMIN,
      status: MembershipStatus.ACTIVE,
    });
    await service.update(currentSession, 'staff-membership', {
      status: MembershipStatus.DISABLED,
    });
    expect(updateMany).toHaveBeenCalledWith({
      where: { membershipId: 'staff-membership', invalidatedAt: null },
      data: { invalidatedAt: expect.any(Date) },
    });
  });

  it('拒绝停用 L1 管理员', async () => {
    const { service } = createSubject({
      id: 'owner-membership',
      role: MembershipRole.L1_ADMIN,
      status: MembershipStatus.ACTIVE,
    });
    await expect(
      service.update(currentSession, 'owner-membership', {
        status: MembershipStatus.DISABLED,
      }),
    ).rejects.toBeInstanceOf(ForbiddenException);
  });
});
