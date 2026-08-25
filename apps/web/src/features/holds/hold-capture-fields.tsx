import type { ChangeEvent } from 'react';
import type { HoldAsset, HoldModelProcessingJob } from './hold-api';

export function HoldCaptureFields(props: {
  modelAsset: HoldAsset | null;
  photoCount: number;
  uploading: boolean;
  modelProcessing: HoldModelProcessingJob | null;
  onModel: (event: ChangeEvent<HTMLInputElement>) => void;
  onPhotos: (event: ChangeEvent<HTMLInputElement>) => void;
}) {
  return (
    <section className="hold-scan-upload">
      <label className="hold-file-field">
        手机扫描原始模型（GLB，必需）
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
      {props.modelAsset && <ModelProcessingStatus job={props.modelProcessing} />}
    </section>
  );
}

function ModelProcessingStatus({ job }: { job: HoldModelProcessingJob | null }) {
  if (!job) return <p>原始模型已保存，正在创建后台任务…</p>;
  if (job.status === 'FAILED') {
    return <p className="is-error">自动清理失败；原始模型和建档不受影响。</p>;
  }
  if (job.status === 'NEEDS_REVIEW') {
    return <p className="is-ready">展示模型已生成，建议后续人工复核。</p>;
  }
  if (job.status === 'COMPLETED') return <p className="is-ready">展示模型已自动生成</p>;
  if (job.status === 'PROCESSING') return <p>后台正在清理桌面和扫描杂面…</p>;
  return <p>原始模型已保存，后台任务已排队；现在即可完成建档。</p>;
}

function photoDescription(count: number): string {
  return count ? `已上传 ${count} 张` : '支持正面、背面和测量照片';
}
