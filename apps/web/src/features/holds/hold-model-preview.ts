import type { HoldAsset } from './hold-api';

export const holdModelPreviewConfig = {
  generationVersion: 1,
  cameraOrbit: '0deg 0deg 105%',
  cameraTarget: 'auto auto auto',
  fieldOfView: '18deg',
  width: 640,
  height: 480,
  mimeType: 'image/webp',
  quality: 0.84,
} as const;

export function findModelPreview(assets: HoldAsset[], modelAssetId: string): HoldAsset | null {
  return (
    assets.find(
      (asset) =>
        asset.kind === 'MODEL_PREVIEW' &&
        asset.status === 'READY' &&
        asset.sourceAssetId === modelAssetId,
    ) ?? null
  );
}

export function createPreviewFile(blob: Blob, modelFileName: string): File {
  const baseName = modelFileName.replace(/\.glb$/i, '') || 'hold-model';
  return new File([blob], `${baseName}-preview.webp`, { type: holdModelPreviewConfig.mimeType });
}
