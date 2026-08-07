import { HoldAssetKind, HoldAssetStatus, MembershipRole } from '@prisma/client';
import type { MultipartFile } from '@fastify/multipart';
import { describe, expect, it, vi } from 'vitest';
import type { CurrentSession } from '../auth/session.service';
import type { PrismaService } from '../database/prisma.service';
import { AccessControlService } from '../security/access-control.service';
import type { ObjectStorageService } from '../storage/object-storage.service';
import { HoldAssetService } from './hold-asset.service';

const session: CurrentSession = {
  account: { id: 'employee-1', email: 'employee@example.com' },
  membership: { id: 'membership-1', displayName: '员工' },
  organization: { id: 'org-1', name: '测试岩馆' },
  role: MembershipRole.L2_ADMIN,
  expiresAt: new Date(),
};

const modelAsset = {
  id: 'model-asset-1',
  organizationId: 'org-1',
  scanId: 'scan-1',
  specificationId: 'specification-1',
  kind: HoldAssetKind.MODEL_3D,
  status: HoldAssetStatus.READY,
  objectKey: 'org-1/model.glb',
  originalFileName: 'hold.glb',
  contentType: 'model/gltf-binary',
  sizeBytes: 512,
  checksumSha256: 'a'.repeat(64),
  metadata: null,
  sourceAssetId: null,
  createdByAccountId: 'employee-1',
  createdAt: new Date('2026-07-24T00:00:00.000Z'),
};

function createWebpFile(): MultipartFile {
  const content = Buffer.alloc(16);
  content.write('RIFF', 0, 'ascii');
  content.write('WEBP', 8, 'ascii');
  return {
    filename: 'hold-preview.webp',
    mimetype: 'image/webp',
    toBuffer: vi.fn().mockResolvedValue(content),
  } as unknown as MultipartFile;
}

function createSubject(derivedAsset: Record<string, unknown> | null = null) {
  const createdPreview = {
    ...modelAsset,
    id: 'preview-1',
    kind: HoldAssetKind.MODEL_PREVIEW,
    objectKey: 'org-1/preview.webp',
    originalFileName: 'hold-preview.webp',
    contentType: 'image/webp',
    sizeBytes: 16,
    checksumSha256: 'b'.repeat(64),
    metadata: { generationVersion: 1 },
    sourceAssetId: modelAsset.id,
  };
  const holdAsset = {
    findFirst: vi.fn().mockResolvedValue({ ...modelAsset, derivedAsset }),
    create: vi.fn().mockResolvedValue(createdPreview),
    update: vi.fn().mockResolvedValue(createdPreview),
  };
  const storage = {
    put: vi.fn().mockResolvedValue(undefined),
    remove: vi.fn().mockResolvedValue(undefined),
  };
  const prisma = { holdAsset } as unknown as PrismaService;
  const service = new HoldAssetService(
    prisma,
    storage as unknown as ObjectStorageService,
    new AccessControlService(),
  );
  return { holdAsset, service, storage };
}

describe('HoldAssetService 模型缩略图', () => {
  it('把 WebP 作为原模型的派生资产保存', async () => {
    const { holdAsset, service, storage } = createSubject();
    const result = await service.uploadPreview(session, modelAsset.id, 1, createWebpFile());
    expect(result.kind).toBe(HoldAssetKind.MODEL_PREVIEW);
    expect(storage.put).toHaveBeenCalledWith(
      expect.stringContaining('/previews/'),
      expect.any(Buffer),
      'image/webp',
    );
    expect(holdAsset.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        kind: HoldAssetKind.MODEL_PREVIEW,
        sourceAssetId: modelAsset.id,
        specificationId: modelAsset.specificationId,
      }),
    });
  });

  it('相同生成版本已存在时直接复用，不重复写入对象存储', async () => {
    const existing = {
      ...modelAsset,
      id: 'preview-1',
      kind: HoldAssetKind.MODEL_PREVIEW,
      metadata: { generationVersion: 1 },
      sourceAssetId: modelAsset.id,
    };
    const { service, storage } = createSubject(existing);
    const result = await service.uploadPreview(session, modelAsset.id, 1, createWebpFile());
    expect(result.id).toBe('preview-1');
    expect(storage.put).not.toHaveBeenCalled();
  });
});
