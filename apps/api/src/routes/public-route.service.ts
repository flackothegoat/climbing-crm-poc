import { GoneException, Injectable, NotFoundException } from '@nestjs/common';
import {
  RoutePublicLinkStatus,
  RouteStatus,
  RouteVersionStatus,
  type Prisma,
} from '@prisma/client';
import { AuditService } from '../common/audit.service';
import { PrismaService } from '../database/prisma.service';
import { RateLimitService } from '../security/rate-limit.service';
import { TokenService } from '../security/token.service';
import { ObjectStorageService } from '../storage/object-storage.service';
import type { SubmitFeedbackInput } from './route-operations.dto';

const publicLinkInclude = {
  route: {
    include: {
      organization: { select: { name: true } },
      versions: {
        orderBy: { versionNumber: 'desc' as const },
        include: {
          setter: { select: { displayName: true } },
          wallSegments: {
            orderBy: { ordinal: 'asc' as const },
            include: { wallSegment: { select: { code: true, name: true } } },
          },
          photo: true,
        },
      },
    },
  },
} satisfies Prisma.RoutePublicLinkInclude;

type PublicLinkRecord = Prisma.RoutePublicLinkGetPayload<{ include: typeof publicLinkInclude }>;

@Injectable()
export class PublicRouteService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly tokens: TokenService,
    private readonly rateLimit: RateLimitService,
    private readonly audit: AuditService,
    private readonly storage: ObjectStorageService,
  ) {}

  async get(token: string, clientIp: string) {
    await this.rateLimit.consume('public-route:read:ip', clientIp, 180, 10);
    const link = await this.resolve(token);
    const version = selectVisibleVersion(link);
    if (!version) throw new NotFoundException('线路尚未发布或已不可用');
    const active =
      link.status === RoutePublicLinkStatus.ACTIVE && link.route.status === RouteStatus.PUBLISHED;
    return {
      availability: active ? 'ACTIVE' : 'RETIRED',
      gymName: link.route.organization.name,
      code: link.route.code,
      name: link.route.name,
      description: link.route.description,
      color: version.color ?? link.route.color,
      grade: version.grade ?? link.route.grade,
      gradeSystem: version.gradeSystem,
      styleTags: version.styleTags,
      setterName: version.setter?.displayName ?? null,
      wallSegments: version.wallSegments.map((item) => item.wallSegment),
      publishedAt:
        version.publishedAt?.toISOString() ?? link.route.publishedAt?.toISOString() ?? null,
      retiredAt: version.retiredAt?.toISOString() ?? link.route.retiredAt?.toISOString() ?? null,
      hasPhoto: Boolean(version.photo),
      metricNotice: '本页反馈用于线路运营复盘，不会被解释为全馆全部尝试次数。',
    };
  }

  async submit(token: string, clientIp: string, input: SubmitFeedbackInput) {
    await Promise.all([
      this.rateLimit.consume('public-route:feedback:ip', clientIp, 60, 10),
      this.rateLimit.consume('public-route:feedback:token', token, 120, 10),
    ]);
    const link = await this.resolve(token);
    if (
      link.status !== RoutePublicLinkStatus.ACTIVE ||
      link.route.status !== RouteStatus.PUBLISHED
    ) {
      throw new GoneException('该线路已经下线，不能继续提交反馈');
    }
    const version = link.route.versions.find(
      (candidate) => candidate.status === RouteVersionStatus.PUBLISHED,
    );
    if (!version) throw new GoneException('该线路当前没有可反馈的发布版本');
    const anonymousSessionKey = this.tokens.hash(input.anonymousSessionId);
    const feedback = await this.prisma.$transaction(async (transaction) => {
      const replay = await transaction.routeFeedback.findUnique({
        where: {
          organizationId_requestKey: {
            organizationId: link.organizationId,
            requestKey: input.requestKey,
          },
        },
      });
      if (replay) return replay;
      const sessionFeedback = await transaction.routeFeedback.findFirst({
        where: {
          organizationId: link.organizationId,
          routeVersionId: version.id,
          anonymousSessionKey,
          submittedAt: { gte: new Date(Date.now() - 6 * 60 * 60_000) },
        },
        orderBy: { submittedAt: 'desc' },
      });
      const data = {
        outcome: input.outcome,
        difficulty: input.difficulty,
        enjoyment: input.enjoyment,
        safetyConcern: input.safetyConcern,
        comment: input.comment || null,
        submittedAt: new Date(),
      };
      const saved = sessionFeedback
        ? await transaction.routeFeedback.update({ where: { id: sessionFeedback.id }, data })
        : await transaction.routeFeedback.create({
            data: {
              ...data,
              organizationId: link.organizationId,
              routeId: link.routeId,
              routeVersionId: version.id,
              publicLinkId: link.id,
              anonymousSessionKey,
              requestKey: input.requestKey,
            },
          });
      await this.audit.record(
        {
          organizationId: link.organizationId,
          type: sessionFeedback ? 'route_feedback.updated' : 'route_feedback.created',
          outcome: 'SUCCESS',
          metadata: {
            feedbackId: saved.id,
            routeId: link.routeId,
            routeVersionId: version.id,
            source: 'QR',
          },
        },
        transaction,
      );
      return saved;
    });
    return { id: feedback.id, submittedAt: feedback.submittedAt.toISOString(), accepted: true };
  }

  async getPhoto(token: string, clientIp: string) {
    await this.rateLimit.consume('public-route:photo:ip', clientIp, 240, 10);
    const link = await this.resolve(token);
    const photo = selectVisibleVersion(link)?.photo;
    if (!photo) throw new NotFoundException('线路照片不存在');
    return { photo, stream: await this.storage.get(photo.objectKey) };
  }

  private async resolve(token: string): Promise<PublicLinkRecord> {
    const linkId = this.tokens.parsePublicRouteToken(token);
    if (!linkId) throw new NotFoundException('线路二维码无效');
    const link = await this.prisma.routePublicLink.findUnique({
      where: { id: linkId },
      include: publicLinkInclude,
    });
    if (!link || link.tokenHash !== this.tokens.hash(token)) {
      throw new NotFoundException('线路二维码无效');
    }
    return link;
  }
}

function selectVisibleVersion(link: PublicLinkRecord) {
  return (
    link.route.versions.find((version) => version.status === RouteVersionStatus.PUBLISHED) ??
    link.route.versions.find((version) => version.status === RouteVersionStatus.RETIRED)
  );
}
