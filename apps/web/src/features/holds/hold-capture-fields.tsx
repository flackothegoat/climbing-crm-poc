import type { ChangeEvent } from 'react';
import type { HoldAsset } from './hold-api';
import type { HoldPreviewStatus } from './use-hold-capture';

export function HoldCaptureFields(props: {
  modelAsset: HoldAsset | null;
  photoCount: number;
  uploading: boolean;
  previewStatus: HoldPreviewStatus;
  onModel: (event: ChangeEvent<HTMLInputElement>) => void;
  onPhotos: (event: ChangeEvent<HTMLInputElement>) => void;
  onRetryPreview: () => void;
}) {
  return (
    <section className="hold-scan-upload">
      <label className="hold-file-field">
        主 3D 模型（GLB，必需）
        <input
          accept=".glb,model/gltf-binary"
          disabled={props.uploading || Boolean(props.modelAsset)}
          type="file"
          onChange={(event) => void props.onModel(event)}
        />
        <small>{props.modelAsset?.originalFileName ?? '单文件不超过 20MB'}</small>
      </label>
      <label className="hold-file-field">
        参考照片（可选）
        <input
          accept=".jpg,.jpeg,.png,.webp,.heic,.heif,image/*"
          disabled={props.uploading}
          multiple
          type="file"
          onChange={(event) => void props.onPhotos(event)}
        />
        <small>{photoDescription(props.photoCount)}</small>
      </label>
      {props.uploading && <p>正在安全上传和校验文件…</p>}
      {props.modelAsset && (
        <CapturePreviewStatus status={props.previewStatus} onRetry={props.onRetryPreview} />
      )}
    </section>
  );
}

function CapturePreviewStatus(props: { status: HoldPreviewStatus; onRetry: () => void }) {
  if (props.status === 'FAILED') {
    return (
      <p className="is-error">
        俯瞰缩略图生成失败。
        <button onClick={props.onRetry} type="button">
          重试
        </button>
      </p>
    );
  }
  if (props.status === 'READY') return <p className="is-ready">俯瞰缩略图已生成</p>;
  if (props.status === 'UPLOADING') return <p>正在安全保存俯瞰缩略图…</p>;
  if (props.status === 'GENERATING') return <p>正在生成俯瞰缩略图…</p>;
  return null;
}

function photoDescription(count: number): string {
  return count ? `已上传 ${count} 张` : '支持正面、背面和测量照片';
}
