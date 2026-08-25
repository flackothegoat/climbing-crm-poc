import { describe, expect, it, vi } from 'vitest';
import type { AuditService } from '../common/audit.service';
import type { PrismaService } from '../database/prisma.service';
import type { RateLimitService } from '../security/rate-limit.service';
import type { TokenService } from '../security/token.service';
import type { ObjectStorageService } from '../storage/object-storage.service';
import { PublicRouteService } from './public-route.service';

describe('PublicRouteService 公开二维码反馈', () => {
  it('只根据签名 link id 和 token 哈希解析线路，不接受伪造 token', async () => {
    const prisma = { routePublicLink: { findUnique: vi.fn() } } as unknown as PrismaService;
    const tokens = {
      parsePublicRouteToken: vi.fn().mockReturnValue(null),
      hash: vi.fn(),
    } as unknown as TokenService;
    const service = createService(prisma, tokens).service;

    await expect(service.get('forged-token-value-0001', '127.0.0.1')).rejects.toThrow(
      '线路二维码无效',
    );
    expect(prisma.routePublicLink.findUnique).not.toHaveBeenCalled();
  });

  it('反馈绑定当前发布版本，匿名会话只存哈希且不保存 IP', async () => {
    const created = { id: 'feedback-1', submittedAt: new Date('2026-08-18T08:00:00Z') };
    const transaction = {
      routeFeedback: {
        findUnique: vi.fn().mockResolvedValue(null),
        findFirst: vi.fn().mockResolvedValue(null),
        create: vi.fn().mockResolvedValue(created),
      },
      auditEvent: { create: vi.fn().mockResolvedValue({}) },
    };
    const prisma = {
      routePublicLink: { findUnique: vi.fn().mockResolvedValue(publicLink()) },
      $transaction: vi.fn(async (callback) => callback(transaction)),
    } as unknown as PrismaService;
    const tokens = {
      parsePublicRouteToken: vi.fn().mockReturnValue('link-0000000001'),
      hash: vi.fn((value: string) =>
        value.startsWith('anonymous') ? 'anonymous-hash' : 'token-hash',
      ),
    } as unknown as TokenService;
    const { service } = createService(prisma, tokens);

    await service.submit('valid-signed-token-0001', '203.0.113.8', {
      outcome: 'COMPLETED',
      difficulty: 'AS_EXPECTED',
      enjoyment: 'LIKE',
      safetyConcern: false,
      comment: null,
      anonymousSessionId: 'anonymous-session-0001',
      requestKey: '75fc093c-974b-4b14-9d79-cd024be97319',
    });

    expect(transaction.routeFeedback.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        organizationId: 'org-1',
        routeId: 'route-1',
        routeVersionId: 'version-1',
        anonymousSessionKey: 'anonymous-hash',
      }),
    });
    expect(transaction.routeFeedback.create).not.toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ ip: expect.anything() }) }),
    );
  });

  it('已撤销二维码仍可展示下线状态，但拒绝新增反馈', async () => {
    const prisma = {
      routePublicLink: {
        findUnique: vi.fn().mockResolvedValue({
          ...publicLink(),
          status: 'REVOKED',
          route: {
            ...publicLink().route,
            status: 'REMOVED',
            versions: [{ ...publicLink().route.versions[0], status: 'RETIRED' }],
          },
        }),
      },
    } as unknown as PrismaService;
    const tokens = {
      parsePublicRouteToken: vi.fn().mockReturnValue('link-0000000001'),
      hash: vi.fn().mockReturnValue('token-hash'),
    } as unknown as TokenService;
    const { service } = createService(prisma, tokens);

    await expect(service.get('valid-signed-token-0001', '203.0.113.8')).resolves.toMatchObject({
      availability: 'RETIRED',
    });
    await expect(
      service.submit('valid-signed-token-0001', '203.0.113.8', {
        outcome: 'ATTEMPTING',
        difficulty: 'AS_EXPECTED',
        enjoyment: 'NEUTRAL',
        safetyConcern: false,
        comment: null,
        anonymousSessionId: 'anonymous-session-0002',
        requestKey: '4e683052-d1ee-473b-874e-8e4395ce66a1',
      }),
    ).rejects.toThrow('该线路已经下线');
    expect(prisma).not.toHaveProperty('$transaction');
  });
});

function createService(prisma: PrismaService, tokens: TokenService) {
  const rateLimit = {
    consume: vi.fn().mockResolvedValue(undefined),
  } as unknown as RateLimitService;
  const audit = { record: vi.fn().mockResolvedValue({}) } as unknown as AuditService;
  const storage = {} as ObjectStorageService;
  return { service: new PublicRouteService(prisma, tokens, rateLimit, audit, storage) };
}

function publicLink() {
  return {
    id: 'link-0000000001',
    organizationId: 'org-1',
    routeId: 'route-1',
    tokenHash: 'token-hash',
    status: 'ACTIVE',
    route: {
      id: 'route-1',
      status: 'PUBLISHED',
      organization: { name: '测试岩馆' },
      versions: [
        {
          id: 'version-1',
          status: 'PUBLISHED',
          versionNumber: 1,
          wallSegments: [],
          photo: null,
          setter: null,
          styleTags: [],
        },
      ],
    },
  };
}
