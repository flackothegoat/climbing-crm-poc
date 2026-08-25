import {
  BadRequestException,
  ConflictException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import type { MultipartFile } from '@fastify/multipart';
import { RouteStatus, RouteVersionStatus } from '@prisma/client';
import { createHash, randomUUID } from 'node:crypto';
import { extname } from 'node:path';
import type { CurrentSession } from '../auth/session.service';
import { AuditService } from '../common/audit.service';
import { PrismaService } from '../database/prisma.service';
import { AccessControlService, Capability } from '../security/access-control.service';
import { ObjectCleanupService } from '../storage/object-cleanup.service';
import { ObjectStorageService } from '../storage/object-storage.service';

const maxPhotoBytes = 10 * 1024 * 1024;

@Injectable()
export class RoutePhotoService {
  private readonly logger = new Logger(RoutePhotoService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly storage: ObjectStorageService,
    private readonly cleanup: ObjectCleanupService,
    private readonly audit: AuditService,
    private readonly access: AccessControlService,
  ) {}

  async upload(session: CurrentSession, routeId: string, file: MultipartFile) {
    this.access.assert(session, Capability.ASSET_DRAFT_WRITE);
    const route = await this.prisma.route.findFirst({
      where: { id: routeId, organizationId: session.organization.id, status: RouteStatus.DRAFT },
      include: {
        versions: {
          where: { status: RouteVersionStatus.DRAFT },
          orderBy: { versionNumber: 'desc' },
          take: 1,
          include: { photo: true, _count: { select: { placements: true } } },
        },
      },
    });
    const version = route?.versions[0];
    if (!route || !version) throw new NotFoundException('可上传照片的线路草稿不存在');
    if (version._count.placements > 0) {
      throw new ConflictException('三维定线草稿的媒体请在实验定线工作台维护');
    }
    const content = await file.toBuffer();
    const validated = validatePhoto(file.filename, content);
    const objectKey = `${session.organization.id}/routes/${route.id}/${version.id}/${randomUUID()}${validated.extension}`;
    await this.storage.put(objectKey, content, validated.contentType);
    const previousObjectKey = version.photo?.objectKey;
    try {
      const photo = await this.prisma.$transaction(async (transaction) => {
        const saved = await transaction.routePhoto.upsert({
          where: { routeVersionId: version.id },
          create: {
            organizationId: session.organization.id,
            routeVersionId: version.id,
            objectKey,
            originalFileName: validated.originalFileName,
            contentType: validated.contentType,
            sizeBytes: content.length,
            checksumSha256: validated.checksumSha256,
            createdByAccountId: session.account.id,
          },
          update: {
            objectKey,
            originalFileName: validated.originalFileName,
            contentType: validated.contentType,
            sizeBytes: content.length,
            checksumSha256: validated.checksumSha256,
            createdByAccountId: session.account.id,
          },
        });
        await this.audit.record(
          {
            organizationId: session.organization.id,
            actorAccountId: session.account.id,
            type: 'route.photo_uploaded',
            outcome: 'SUCCESS',
            metadata: { routeId, routeVersionId: version.id, photoId: saved.id },
          },
          transaction,
        );
        return saved;
      });
      if (previousObjectKey && previousObjectKey !== objectKey) {
        await this.removeQuietly(previousObjectKey, 'route-photo-replaced');
      }
      return {
        id: photo.id,
        originalFileName: photo.originalFileName,
        contentType: photo.contentType,
        sizeBytes: photo.sizeBytes,
        updatedAt: photo.updatedAt.toISOString(),
      };
    } catch (error) {
      await this.removeQuietly(objectKey, 'route-photo-compensation');
      throw error;
    }
  }

  async get(session: CurrentSession, routeId: string) {
    this.access.assert(session, Capability.ASSET_READ);
    const route = await this.prisma.route.findFirst({
      where: { id: routeId, organizationId: session.organization.id },
      include: {
        versions: {
          orderBy: { versionNumber: 'desc' },
          include: { photo: true },
        },
      },
    });
    const photo = route?.versions.find((version) => version.photo)?.photo;
    if (!photo) throw new NotFoundException('线路照片不存在');
    return { photo, stream: await this.storage.get(photo.objectKey) };
  }

  private async removeQuietly(objectKey: string, reason: string) {
    try {
      await this.storage.remove(objectKey);
    } catch (error) {
      this.logger.warn(`线路照片清理失败，已进入重试队列: ${objectKey}`);
      await this.cleanup.enqueue(objectKey, reason, error);
    }
  }
}

function validatePhoto(filename: string, content: Buffer) {
  if (!content.length) throw new BadRequestException('线路照片不能为空');
  if (content.length > maxPhotoBytes) throw new BadRequestException('线路照片不能超过 10 MB');
  const detected = detectImage(content);
  if (!detected) throw new BadRequestException('仅支持 JPEG、PNG 或 WebP 线路照片');
  const safeName = filename.trim().slice(0, 180) || `route-photo${detected.extension}`;
  const suppliedExtension = extname(safeName).toLowerCase();
  if (suppliedExtension && !['.jpg', '.jpeg', '.png', '.webp'].includes(suppliedExtension)) {
    throw new BadRequestException('线路照片文件扩展名不受支持');
  }
  return {
    ...detected,
    originalFileName: safeName,
    checksumSha256: createHash('sha256').update(content).digest('hex'),
  };
}

function detectImage(content: Buffer): { contentType: string; extension: string } | null {
  if (content.length >= 3 && content[0] === 0xff && content[1] === 0xd8 && content[2] === 0xff) {
    return { contentType: 'image/jpeg', extension: '.jpg' };
  }
  if (
    content.length >= 8 &&
    content.subarray(0, 8).equals(Buffer.from('89504e470d0a1a0a', 'hex'))
  ) {
    return { contentType: 'image/png', extension: '.png' };
  }
  if (
    content.length >= 12 &&
    content.subarray(0, 4).toString('ascii') === 'RIFF' &&
    content.subarray(8, 12).toString('ascii') === 'WEBP'
  ) {
    return { contentType: 'image/webp', extension: '.webp' };
  }
  return null;
}
