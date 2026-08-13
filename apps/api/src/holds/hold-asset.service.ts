import { ConflictException, Injectable, Logger, NotFoundException } from '@nestjs/common';
import { HoldAssetKind, HoldAssetStatus, HoldScanStatus, type HoldAsset } from '@prisma/client';
import type { MultipartFile } from '@fastify/multipart';
import { randomUUID } from 'node:crypto';
import { basename, extname } from 'node:path';
import type { CurrentSession } from '../auth/session.service';
import { isPrismaError } from '../database/prisma-errors';
import { PrismaService } from '../database/prisma.service';
import { AccessControlService, Capability } from '../security/access-control.service';
import { ObjectStorageService } from '../storage/object-storage.service';
import { ObjectCleanupService } from '../storage/object-cleanup.service';
import { validateHoldAsset } from './hold-asset-file';

@Injectable()
export class HoldAssetService {
  private readonly logger = new Logger(HoldAssetService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly storage: ObjectStorageService,
    private readonly cleanup: ObjectCleanupService,
    private readonly access: AccessControlService,
  ) {}

  async upload(session: CurrentSession, scanId: string, kind: HoldAssetKind, file: MultipartFile) {
    this.access.assert(session, Capability.HOLD_WRITE);
    await this.assertDraftScan(session.organization.id, scanId, kind);
    const content = await file.toBuffer();
    const validated = validateHoldAsset(kind, file.filename, content);
    const objectKey = buildObjectKey(session.organization.id, scanId, validated.extension);
    await this.storage.put(objectKey, content, validated.contentType);
    try {
      const asset = await this.prisma.holdAsset.create({
        data: {
          organizationId: session.organization.id,
          scanId,
          kind,
          objectKey,
          originalFileName: validated.originalFileName,
          contentType: validated.contentType,
          sizeBytes: content.length,
          checksumSha256: validated.checksumSha256,
          metadata: validated.metadata,
          createdByAccountId: session.account.id,
        },
      });
      return toAsset(asset);
    } catch (error) {
      await this.removeObjectQuietly(objectKey);
      if (isPrismaError(error, 'P2002') && kind === HoldAssetKind.MODEL_3D) {
        throw new ConflictException('该采集草稿已经有主三维模型，请刷新页面');
      }
      throw error;
    }
  }

  async getContent(session: CurrentSession, assetId: string) {
    this.access.assert(session, Capability.HOLD_READ);
    const asset = await this.prisma.holdAsset.findFirst({
      where: {
        id: assetId,
        organizationId: session.organization.id,
        status: HoldAssetStatus.READY,
      },
    });
    if (!asset) throw new NotFoundException('岩点扫描资产不存在');
    return { asset, stream: await this.storage.get(asset.objectKey) };
  }

  async uploadPreview(
    session: CurrentSession,
    modelAssetId: string,
    generationVersion: number,
    file: MultipartFile,
  ) {
    this.access.assert(session, Capability.HOLD_WRITE);
    const source = await this.findPreviewSource(session.organization.id, modelAssetId);
    if (source.derivedAsset && isCurrentPreview(source.derivedAsset, generationVersion)) {
      return toAsset(source.derivedAsset);
    }
    const content = await file.toBuffer();
    const validated = validateHoldAsset(HoldAssetKind.MODEL_PREVIEW, file.filename, content);
    const objectKey = buildPreviewObjectKey(source.organizationId, source.scanId);
    await this.storage.put(objectKey, content, 'image/webp');
    try {
      const preview = await this.savePreview(
        source,
        objectKey,
        content.length,
        validated.checksumSha256,
        generationVersion,
        session.account.id,
      );
      await this.removeReplacedObject(source.derivedAsset?.objectKey, objectKey);
      return toAsset(preview);
    } catch (error) {
      await this.removeObjectQuietly(objectKey);
      if (isPrismaError(error, 'P2002')) return this.findConcurrentPreview(modelAssetId);
      throw error;
    }
  }

  async removeObjects(assets: Array<Pick<HoldAsset, 'objectKey'>>): Promise<void> {
    for (const asset of assets) await this.storage.remove(asset.objectKey);
  }

  async removeObjectsQuietly(assets: Array<Pick<HoldAsset, 'objectKey'>>): Promise<void> {
    for (const asset of assets) await this.removeObjectQuietly(asset.objectKey);
  }

  private async assertDraftScan(
    organizationId: string,
    scanId: string,
    kind: HoldAssetKind,
  ): Promise<void> {
    const scan = await this.prisma.holdScan.findFirst({
      where: { id: scanId, organizationId, status: HoldScanStatus.DRAFT },
      include: {
        assets: {
          where: { kind: HoldAssetKind.MODEL_3D, status: HoldAssetStatus.READY },
          select: { id: true },
        },
      },
    });
    if (!scan) throw new NotFoundException('可上传的扫描草稿不存在');
    if (kind === HoldAssetKind.MODEL_3D && scan.assets.length) {
      throw new ConflictException('一个扫描档案只能上传一个主 3D 模型');
    }
  }

  private async findPreviewSource(organizationId: string, modelAssetId: string) {
    const source = await this.prisma.holdAsset.findFirst({
      where: {
        id: modelAssetId,
        organizationId,
        kind: HoldAssetKind.MODEL_3D,
        status: HoldAssetStatus.READY,
      },
      include: { derivedAsset: true },
    });
    if (!source) throw new NotFoundException('可生成缩略图的三维模型不存在');
    return source;
  }

  private savePreview(
    source: Awaited<ReturnType<HoldAssetService['findPreviewSource']>>,
    objectKey: string,
    sizeBytes: number,
    checksumSha256: string,
    generationVersion: number,
    createdByAccountId: string,
  ) {
    const fileData = {
      objectKey,
      originalFileName: previewFileName(source.originalFileName),
      contentType: 'image/webp',
      sizeBytes,
      checksumSha256,
      metadata: { generationVersion },
      status: HoldAssetStatus.READY,
    };
    if (source.derivedAsset) {
      return this.prisma.holdAsset.update({
        where: { id: source.derivedAsset.id },
        data: fileData,
      });
    }
    return this.prisma.holdAsset.create({
      data: {
        ...fileData,
        organizationId: source.organizationId,
        scanId: source.scanId,
        specificationId: source.specificationId,
        kind: HoldAssetKind.MODEL_PREVIEW,
        sourceAssetId: source.id,
        createdByAccountId,
      },
    });
  }

  private async findConcurrentPreview(modelAssetId: string) {
    const preview = await this.prisma.holdAsset.findFirst({
      where: { sourceAssetId: modelAssetId, status: HoldAssetStatus.READY },
    });
    if (!preview) throw new ConflictException('缩略图已由其他请求生成，请刷新后重试');
    return toAsset(preview);
  }

  private async removeReplacedObject(previousKey: string | undefined, nextKey: string) {
    if (previousKey && previousKey !== nextKey) await this.removeObjectQuietly(previousKey);
  }

  private async removeObjectQuietly(objectKey: string): Promise<void> {
    try {
      await this.storage.remove(objectKey);
    } catch (error) {
      this.logger.warn(`对象文件清理失败，已进入重试队列: ${objectKey}`, error);
      await this.cleanup.enqueue(objectKey, 'hold-asset-compensation', error);
    }
  }
}

export function toAsset(asset: HoldAsset) {
  return {
    id: asset.id,
    kind: asset.kind,
    status: asset.status,
    originalFileName: asset.originalFileName,
    contentType: asset.contentType,
    sizeBytes: asset.sizeBytes,
    checksumSha256: asset.checksumSha256,
    metadata: asset.metadata,
    sourceAssetId: asset.sourceAssetId,
    createdAt: asset.createdAt.toISOString(),
  };
}

function buildPreviewObjectKey(organizationId: string, scanId: string): string {
  return `${organizationId}/hold-scans/${scanId}/previews/${randomUUID()}.webp`;
}

function previewFileName(modelFileName: string): string {
  const extension = extname(modelFileName);
  return `${basename(modelFileName, extension)}-preview.webp`;
}

function isCurrentPreview(asset: HoldAsset, generationVersion: number): boolean {
  if (asset.status !== HoldAssetStatus.READY) return false;
  const metadata = asset.metadata;
  if (!metadata || Array.isArray(metadata) || typeof metadata !== 'object') return false;
  return metadata.generationVersion === generationVersion;
}

function buildObjectKey(organizationId: string, scanId: string, extension: string): string {
  return `${organizationId}/hold-scans/${scanId}/${randomUUID()}${extension}`;
}
