import {
  BadRequestException,
  ConflictException,
  GoneException,
  Injectable,
  Logger,
  NotFoundException,
  OnModuleDestroy,
  OnModuleInit,
  ServiceUnavailableException,
} from '@nestjs/common';
import { CameraObservationEvidenceStatus, ClimbObservationSource } from '@prisma/client';
import { createHash, randomUUID } from 'node:crypto';
import type { Readable } from 'node:stream';
import { Transform } from 'node:stream';
import type { CurrentSession } from '../auth/session.service';
import { AuditService } from '../common/audit.service';
import { AppConfigService } from '../config/app-config.service';
import { PrismaService } from '../database/prisma.service';
import { AccessControlService, Capability } from '../security/access-control.service';
import { ObjectCleanupService } from '../storage/object-cleanup.service';
import { ObjectStorageService } from '../storage/object-storage.service';
import type { CameraObservationEvidenceInput } from './camera-observation.dto';

const regularRetentionMs = 72 * 60 * 60 * 1_000;
const reviewRetentionMs = 14 * 24 * 60 * 60 * 1_000;
const retentionSweepMs = 15 * 60 * 1_000;

@Injectable()
export class CameraObservationEvidenceService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(CameraObservationEvidenceService.name);
  private timer?: NodeJS.Timeout;
  private sweeping = false;

  constructor(
    private readonly prisma: PrismaService,
    private readonly storage: ObjectStorageService,
    private readonly cleanup: ObjectCleanupService,
    private readonly audit: AuditService,
    private readonly access: AccessControlService,
    private readonly config: AppConfigService,
  ) {}

  onModuleInit(): void {
    void this.sweepExpired();
    this.timer = setInterval(() => void this.sweepExpired(), retentionSweepMs);
    this.timer.unref();
  }

  onModuleDestroy(): void {
    if (this.timer) clearInterval(this.timer);
  }

  async uploadFromWorker(
    observationId: string,
    video: Readable,
    input: CameraObservationEvidenceInput,
  ) {
    const organizationId = this.config.values.CAMERA_WORKER_ORGANIZATION_ID;
    if (!organizationId) throw new ServiceUnavailableException('视觉 Worker 尚未绑定岩馆');
    const observation = await this.prisma.climbObservation.findFirst({
      where: { id: observationId, organizationId, source: ClimbObservationSource.CAMERA },
      select: { id: true, metadata: true, reviewStatus: true, evidence: true },
    });
    if (!observation) throw new NotFoundException('摄像头识别记录不存在');
    if (observation.evidence) {
      if (observation.evidence.checksumSha256 === input.checksumSha256) {
        return mapEvidence(observation.evidence);
      }
      throw new ConflictException('该识别记录已经关联其他录像');
    }

    const objectKey = `${organizationId}/camera-observations/${observation.id}/${randomUUID()}.mp4`;
    const verifier = new HashingTransform();
    video.pipe(verifier);
    await this.storage.putStream(objectKey, verifier, input.sizeBytes, 'video/mp4');
    if (verifier.sizeBytes !== input.sizeBytes || verifier.checksum !== input.checksumSha256) {
      await this.removeOrQueue(objectKey, 'camera-evidence-invalid');
      throw new BadRequestException('录像大小或校验值不匹配');
    }

    const requiresReview = metadataBoolean(observation.metadata, 'requiresReview');
    const retentionMs =
      observation.reviewStatus === 'OVERRIDDEN'
        ? 30 * 24 * 60 * 60 * 1_000
        : observation.reviewStatus === 'UNREVIEWED' && requiresReview
          ? reviewRetentionMs
          : regularRetentionMs;
    const expiresAt = new Date(Date.now() + retentionMs);
    try {
      const evidence = await this.prisma.cameraObservationEvidence.create({
        data: {
          organizationId,
          observationId,
          objectKey,
          contentType: 'video/mp4',
          sizeBytes: input.sizeBytes,
          checksumSha256: input.checksumSha256.toLowerCase(),
          durationMs: input.durationMs,
          expiresAt,
        },
      });
      await this.audit.record({
        organizationId,
        type: 'camera.observation.evidence_uploaded',
        outcome: 'SUCCESS',
        metadata: { observationId, evidenceId: evidence.id, expiresAt: expiresAt.toISOString() },
      });
      return mapEvidence(evidence);
    } catch (error) {
      await this.removeOrQueue(objectKey, 'camera-evidence-compensation');
      throw error;
    }
  }

  async get(session: CurrentSession, observationId: string, rangeHeader?: string) {
    this.access.assert(session, Capability.ASSET_READ);
    const evidence = await this.prisma.cameraObservationEvidence.findFirst({
      where: { observationId, organizationId: session.organization.id },
    });
    if (!evidence) throw new NotFoundException('该识别记录没有可用录像');
    if (
      evidence.status === CameraObservationEvidenceStatus.EXPIRED ||
      evidence.expiresAt.getTime() <= Date.now()
    ) {
      throw new GoneException('录像已按安全保留策略过期');
    }
    const range = parseByteRange(rangeHeader, evidence.sizeBytes);
    const stream = range
      ? await this.storage.getPartial(evidence.objectKey, range.start, range.length)
      : await this.storage.get(evidence.objectKey);
    return { evidence, stream, range };
  }

  async sweepExpired(limit = 50): Promise<number> {
    if (this.sweeping) return 0;
    this.sweeping = true;
    try {
      const expired = await this.prisma.cameraObservationEvidence.findMany({
        where: {
          status: CameraObservationEvidenceStatus.AVAILABLE,
          expiresAt: { lte: new Date() },
        },
        orderBy: { expiresAt: 'asc' },
        take: Math.min(Math.max(limit, 1), 100),
      });
      for (const evidence of expired) {
        try {
          await this.storage.remove(evidence.objectKey);
        } catch (error) {
          await this.cleanup.enqueue(evidence.objectKey, 'camera-evidence-expired', error);
        }
        await this.prisma.cameraObservationEvidence.update({
          where: { id: evidence.id },
          data: { status: CameraObservationEvidenceStatus.EXPIRED, expiredAt: new Date() },
        });
        await this.audit.record({
          organizationId: evidence.organizationId,
          type: 'camera.observation.evidence_expired',
          outcome: 'SUCCESS',
          metadata: { observationId: evidence.observationId, evidenceId: evidence.id },
        });
      }
      return expired.length;
    } catch (error) {
      this.logger.warn('摄像头录像过期清理失败', error);
      return 0;
    } finally {
      this.sweeping = false;
    }
  }

  private async removeOrQueue(objectKey: string, reason: string): Promise<void> {
    try {
      await this.storage.remove(objectKey);
    } catch (error) {
      await this.cleanup.enqueue(objectKey, reason, error);
    }
  }
}

class HashingTransform extends Transform {
  private readonly hash = createHash('sha256');
  sizeBytes = 0;

  get checksum(): string {
    return this.hash.copy().digest('hex');
  }

  override _transform(
    chunk: Buffer,
    _encoding: BufferEncoding,
    callback: (error?: Error | null, data?: Buffer) => void,
  ): void {
    this.hash.update(chunk);
    this.sizeBytes += chunk.length;
    callback(null, chunk);
  }
}

function metadataBoolean(metadata: unknown, key: string): boolean {
  if (!metadata || typeof metadata !== 'object' || Array.isArray(metadata)) return false;
  return Boolean((metadata as Record<string, unknown>)[key]);
}

function parseByteRange(value: string | undefined, sizeBytes: number) {
  if (!value) return null;
  const match = /^bytes=(\d+)-(\d*)$/.exec(value.trim());
  if (!match) throw new BadRequestException('录像 Range 请求格式不正确');
  const start = Number(match[1]);
  const requestedEnd = match[2] ? Number(match[2]) : sizeBytes - 1;
  if (!Number.isSafeInteger(start) || start < 0 || start >= sizeBytes) {
    throw new BadRequestException('录像 Range 起点超出范围');
  }
  const end = Math.min(requestedEnd, sizeBytes - 1);
  if (!Number.isSafeInteger(end) || end < start) {
    throw new BadRequestException('录像 Range 终点超出范围');
  }
  return { start, end, length: end - start + 1 };
}

function mapEvidence(evidence: {
  id: string;
  status: CameraObservationEvidenceStatus;
  contentType: string;
  sizeBytes: number;
  durationMs: number;
  expiresAt: Date;
  expiredAt: Date | null;
}) {
  return {
    id: evidence.id,
    status: evidence.status,
    contentType: evidence.contentType,
    sizeBytes: evidence.sizeBytes,
    durationMs: evidence.durationMs,
    expiresAt: evidence.expiresAt.toISOString(),
    expiredAt: evidence.expiredAt?.toISOString() ?? null,
  };
}
