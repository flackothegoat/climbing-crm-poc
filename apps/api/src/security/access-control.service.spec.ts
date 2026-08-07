import { ForbiddenException } from '@nestjs/common';
import { MembershipRole } from '@prisma/client';
import { describe, expect, it } from 'vitest';
import type { CurrentSession } from '../auth/session.service';
import { AccessControlService, Capability } from './access-control.service';

function session(role: MembershipRole): CurrentSession {
  return {
    account: { id: 'account-1', email: 'staff@example.com' },
    membership: { id: 'membership-1', displayName: '测试员工' },
    organization: { id: 'org-1', name: '测试岩馆' },
    role,
    expiresAt: new Date(),
  };
}

describe('AccessControlService', () => {
  const access = new AccessControlService();

  it('允许 L2 维护目录和执行正常入库', () => {
    expect(() =>
      access.assert(session(MembershipRole.L2_ADMIN), Capability.HOLD_WRITE),
    ).not.toThrow();
    expect(() =>
      access.assert(session(MembershipRole.L2_ADMIN), Capability.HOLD_RECEIVE),
    ).not.toThrow();
  });

  it('拒绝 L2 调账、归档和发布资产', () => {
    expect(() => access.assert(session(MembershipRole.L2_ADMIN), Capability.HOLD_ADJUST)).toThrow(
      ForbiddenException,
    );
    expect(() => access.assert(session(MembershipRole.L2_ADMIN), Capability.HOLD_ARCHIVE)).toThrow(
      ForbiddenException,
    );
    expect(() => access.assert(session(MembershipRole.L2_ADMIN), Capability.ASSET_PUBLISH)).toThrow(
      ForbiddenException,
    );
  });
});
