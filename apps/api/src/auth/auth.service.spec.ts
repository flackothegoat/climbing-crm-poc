import { UnauthorizedException } from '@nestjs/common';
import { MembershipRole } from '@prisma/client';
import bcrypt from 'bcryptjs';
import { describe, expect, it, vi } from 'vitest';
import type { AuditService } from '../common/audit.service';
import type { AppConfigService } from '../config/app-config.service';
import type { PrismaService } from '../database/prisma.service';
import type { RateLimitService } from '../security/rate-limit.service';
import type { TokenService } from '../security/token.service';
import { AuthService } from './auth.service';

function dependencies(account: unknown) {
  const transaction = {
    authSession: { create: vi.fn().mockResolvedValue({}) },
  };
  const prisma = {
    account: { findUnique: vi.fn().mockResolvedValue(account) },
    $transaction: vi.fn(async (callback) => callback(transaction)),
  } as unknown as PrismaService;
  const rateLimit = {
    consume: vi.fn().mockResolvedValue(undefined),
    reset: vi.fn().mockResolvedValue(undefined),
  } as unknown as RateLimitService;
  const tokens = {
    createRawToken: vi.fn().mockReturnValue('raw-session-token'),
    hash: vi.fn((value: string) => `hash:${value}`),
  } as unknown as TokenService;
  const audit = { record: vi.fn().mockResolvedValue({}) } as unknown as AuditService;
  const config = {
    values: { SESSION_TTL_HOURS: 12 },
  } as unknown as AppConfigService;
  return {
    service: new AuthService(prisma, tokens, rateLimit, audit, config),
    prisma,
    transaction,
    rateLimit,
    audit,
  };
}

describe('AuthService', () => {
  it('在查账号与校验密码前原子消耗邮箱和 IP 额度', async () => {
    const { service, prisma, rateLimit } = dependencies(null);

    await expect(
      service.login({ email: 'owner@example.com', password: 'incorrect-password' }, '127.0.0.1'),
    ).rejects.toBeInstanceOf(UnauthorizedException);

    expect(rateLimit.consume).toHaveBeenCalledTimes(2);
    expect(vi.mocked(rateLimit.consume).mock.invocationCallOrder[0]).toBeLessThan(
      vi.mocked(prisma.account.findUnique).mock.invocationCallOrder[0]!,
    );
  });

  it('会话和成功审计在同一事务内提交', async () => {
    const password = 'correct-password';
    const organization = { id: 'org-1', name: '测试岩馆' };
    const { service, transaction, rateLimit, audit } = dependencies({
      id: 'account-1',
      status: 'ACTIVE',
      passwordHash: await bcrypt.hash(password, 4),
      memberships: [
        {
          id: 'membership-1',
          organizationId: organization.id,
          role: MembershipRole.L1_ADMIN,
          organization,
        },
      ],
    });

    const result = await service.login({ email: 'owner@example.com', password }, '127.0.0.1');

    expect(result.organization).toEqual(organization);
    expect(transaction.authSession.create).toHaveBeenCalledOnce();
    expect(audit.record).toHaveBeenCalledWith(
      expect.objectContaining({ type: 'auth.login', outcome: 'SUCCESS' }),
      transaction,
    );
    expect(rateLimit.reset).toHaveBeenCalledWith('login:email', 'owner@example.com');
  });
});
