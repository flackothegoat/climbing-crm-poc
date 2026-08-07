import { UnauthorizedException } from '@nestjs/common';
import { describe, expect, it, vi } from 'vitest';
import { PrismaService } from '../database/prisma.service';
import { TokenService } from '../security/token.service';
import { SessionService } from './session.service';

function createSubject(sessionRecord: unknown) {
  const findFirst = vi.fn().mockResolvedValue(sessionRecord);
  const updateMany = vi.fn().mockResolvedValue({ count: 1 });
  const prisma = { authSession: { findFirst, updateMany } } as unknown as PrismaService;
  const tokens = { hash: vi.fn().mockReturnValue('hashed-token') } as unknown as TokenService;
  return { subject: new SessionService(prisma, tokens), findFirst, updateMany };
}

describe('SessionService', () => {
  it('返回当前账号、岩馆和角色', async () => {
    const expiresAt = new Date('2026-08-01T00:00:00.000Z');
    const record = {
      expiresAt,
      account: { id: 'account-1', email: 'owner@example.com' },
      membership: {
        id: 'membership-1',
        displayName: '岩馆老板',
        role: 'L1_ADMIN',
        organization: { id: 'org-1', name: 'Peak Climbing' },
      },
    };
    const { subject } = createSubject(record);
    await expect(subject.getCurrent('raw-token')).resolves.toEqual({
      account: { id: 'account-1', email: 'owner@example.com' },
      membership: { id: 'membership-1', displayName: '岩馆老板' },
      organization: { id: 'org-1', name: 'Peak Climbing' },
      role: 'L1_ADMIN',
      expiresAt,
    });
  });

  it('拒绝无效会话', async () => {
    const { subject } = createSubject(null);
    await expect(subject.getCurrent('invalid-token')).rejects.toBeInstanceOf(UnauthorizedException);
  });

  it('退出时使会话失效', async () => {
    const { subject, updateMany } = createSubject(null);
    await subject.invalidate('raw-token');
    expect(updateMany).toHaveBeenCalledOnce();
  });
});
