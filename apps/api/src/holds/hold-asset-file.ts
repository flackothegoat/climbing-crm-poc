import { BadRequestException } from '@nestjs/common';
import { HoldAssetKind } from '@prisma/client';
import { createHash } from 'node:crypto';
import { basename, extname } from 'node:path';

const GLB_MAGIC = 0x46546c67;
const GLB_VERSION = 2;
const MODEL_PREVIEW_MAX_BYTES = 2 * 1024 * 1024;
const modelExtensions = new Set(['.glb']);
const imageExtensions = new Set(['.jpg', '.jpeg', '.png', '.webp', '.heic', '.heif']);

export interface ValidatedHoldFile {
  originalFileName: string;
  extension: string;
  contentType: string;
  checksumSha256: string;
  metadata?: Record<string, number>;
}

export function validateHoldAsset(
  kind: HoldAssetKind,
  fileName: string,
  content: Buffer,
): ValidatedHoldFile {
  if (!content.length) throw new BadRequestException('上传文件不能为空');
  const originalFileName = safeFileName(fileName);
  const extension = extname(originalFileName).toLowerCase();
  const metadata =
    kind === HoldAssetKind.MODEL_3D || kind === HoldAssetKind.MODEL_SOURCE
      ? validateGlb(extension, content)
      : kind === HoldAssetKind.MODEL_PREVIEW
        ? validateModelPreview(extension, content)
        : validateImage(extension, content);
  return {
    originalFileName,
    extension,
    contentType: trustedContentType(kind, content),
    checksumSha256: createHash('sha256').update(content).digest('hex'),
    metadata,
  };
}

function trustedContentType(kind: HoldAssetKind, content: Buffer): string {
  if (kind === HoldAssetKind.MODEL_3D || kind === HoldAssetKind.MODEL_SOURCE) {
    return 'model/gltf-binary';
  }
  if (kind === HoldAssetKind.MODEL_PREVIEW || hasWebpSignature(content)) return 'image/webp';
  if (content[0] === 0xff && content[1] === 0xd8) return 'image/jpeg';
  if (content.subarray(1, 4).toString('ascii') === 'PNG') return 'image/png';
  return 'image/heif';
}

function validateModelPreview(extension: string, content: Buffer): undefined {
  if (extension !== '.webp' || !hasWebpSignature(content)) {
    throw new BadRequestException('三维模型缩略图仅支持 WebP');
  }
  if (content.length > MODEL_PREVIEW_MAX_BYTES) {
    throw new BadRequestException('三维模型缩略图不能超过 2 MB');
  }
}

function validateGlb(extension: string, content: Buffer): Record<string, number> {
  if (!modelExtensions.has(extension) || content.length < 20) {
    throw new BadRequestException('3D 模型仅支持有效的 GLB 文件');
  }
  const magic = content.readUInt32LE(0);
  const version = content.readUInt32LE(4);
  const declaredLength = content.readUInt32LE(8);
  if (magic !== GLB_MAGIC || version !== GLB_VERSION || declaredLength !== content.length) {
    throw new BadRequestException('GLB 文件结构无效或上传不完整');
  }
  return readGlbGeometry(content);
}

function readGlbGeometry(content: Buffer): Record<string, number> {
  try {
    const jsonLength = content.readUInt32LE(12);
    const rawJson = content
      .subarray(20, 20 + jsonLength)
      .toString('utf8')
      .replaceAll('\0', '');
    const document = JSON.parse(rawJson) as {
      meshes?: unknown[];
      materials?: unknown[];
      textures?: unknown[];
      accessors?: Array<{ type?: string; count?: number }>;
    };
    const positions = document.accessors?.find((item) => item.type === 'VEC3');
    return {
      meshCount: document.meshes?.length ?? 0,
      materialCount: document.materials?.length ?? 0,
      textureCount: document.textures?.length ?? 0,
      vertexCount: positions?.count ?? 0,
    };
  } catch {
    throw new BadRequestException('无法读取 GLB 模型元数据');
  }
}

function validateImage(extension: string, content: Buffer): undefined {
  if (!imageExtensions.has(extension) || !hasKnownImageSignature(content)) {
    throw new BadRequestException('照片仅支持 JPEG、PNG、WebP 或 HEIC/HEIF');
  }
}

function hasKnownImageSignature(content: Buffer): boolean {
  const jpeg = content[0] === 0xff && content[1] === 0xd8;
  const png = content.subarray(1, 4).toString('ascii') === 'PNG';
  const webp = hasWebpSignature(content);
  const heifBrand = content.subarray(4, 12).toString('ascii');
  return jpeg || png || webp || heifBrand.startsWith('ftyp');
}

function hasWebpSignature(content: Buffer): boolean {
  return (
    content.subarray(0, 4).toString('ascii') === 'RIFF' &&
    content.subarray(8, 12).toString('ascii') === 'WEBP'
  );
}

function safeFileName(fileName: string): string {
  const value = Array.from(basename(fileName))
    .filter((character) => character.charCodeAt(0) >= 32)
    .join('')
    .slice(0, 160);
  if (!value) throw new BadRequestException('文件名无效');
  return value;
}
