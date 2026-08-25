import { describe, expect, it } from 'vitest';
import type { HoldAsset } from './hold-api';
import { createPreviewFile, findModelPreview } from './hold-model-preview';

const model = buildAsset('model-1', 'MODEL_3D', null);
const preview = buildAsset('preview-1', 'MODEL_PREVIEW', model.id);

describe('岩点模型缩略图', () => {
  it('只使用当前模型的可用派生缩略图', () => {
    expect(findModelPreview([model, preview], model.id)).toEqual(preview);
    expect(
      findModelPreview([model, { ...preview, sourceAssetId: 'other-model' }], model.id),
    ).toBeNull();
  });

  it('使用稳定文件名创建 WebP 文件', () => {
    const file = createPreviewFile(new Blob(['preview']), 'yellow-hold.glb');
    expect(file.name).toBe('yellow-hold-preview.webp');
    expect(file.type).toBe('image/webp');
  });
});

function buildAsset(id: string, kind: HoldAsset['kind'], sourceAssetId: string | null): HoldAsset {
  return {
    id,
    scanId: 'scan-1',
    kind,
    sourceAssetId,
    status: 'READY',
    originalFileName: kind === 'MODEL_3D' ? 'hold.glb' : 'hold-preview.webp',
    contentType: kind === 'MODEL_3D' ? 'model/gltf-binary' : 'image/webp',
    sizeBytes: 16,
    metadata: null,
    createdAt: '2026-07-24T00:00:00.000Z',
  };
}
