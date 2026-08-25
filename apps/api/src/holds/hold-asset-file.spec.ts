import { HoldAssetKind } from '@prisma/client';
import { describe, expect, it } from 'vitest';
import { validateHoldAsset } from './hold-asset-file';

function minimalGlb(): Buffer {
  const json = Buffer.from('{"asset":{"version":"2.0"}}  ');
  const content = Buffer.alloc(20 + json.length);
  content.writeUInt32LE(0x46546c67, 0);
  content.writeUInt32LE(2, 4);
  content.writeUInt32LE(content.length, 8);
  content.writeUInt32LE(json.length, 12);
  content.writeUInt32LE(0x4e4f534a, 16);
  json.copy(content, 20);
  return content;
}

describe('hold asset validation', () => {
  it('accepts a structurally valid GLB', () => {
    const result = validateHoldAsset(HoldAssetKind.MODEL_3D, 'hold.glb', minimalGlb());
    expect(result.extension).toBe('.glb');
    expect(result.checksumSha256).toHaveLength(64);
  });

  it('validates an immutable source scan as a GLB', () => {
    const result = validateHoldAsset(HoldAssetKind.MODEL_SOURCE, 'phone-scan.glb', minimalGlb());
    expect(result.contentType).toBe('model/gltf-binary');
    expect(result.extension).toBe('.glb');
  });

  it('rejects a renamed non-GLB file', () => {
    expect(() => validateHoldAsset(HoldAssetKind.MODEL_3D, 'fake.glb', Buffer.from('no'))).toThrow(
      '3D 模型仅支持有效的 GLB 文件',
    );
  });

  it('accepts an automatically generated WebP preview', () => {
    const content = Buffer.alloc(16);
    content.write('RIFF', 0, 'ascii');
    content.write('WEBP', 8, 'ascii');
    const result = validateHoldAsset(HoldAssetKind.MODEL_PREVIEW, 'hold-preview.webp', content);
    expect(result.extension).toBe('.webp');
  });

  it('rejects non-WebP files as model previews', () => {
    const png = Buffer.from([0x89, 0x50, 0x4e, 0x47]);
    expect(() => validateHoldAsset(HoldAssetKind.MODEL_PREVIEW, 'hold-preview.png', png)).toThrow(
      '三维模型缩略图仅支持 WebP',
    );
  });
});
