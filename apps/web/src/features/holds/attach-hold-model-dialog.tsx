'use client';

import { DialogShell } from '../common/dialog-shell';
import { climbingColorLabel } from '../common/climbing-colors';
import {
  completeHoldModelAttachment,
  createHoldModelAttachment,
  type HoldSpecification,
} from './hold-api';
import { HoldCaptureFields } from './hold-capture-fields';
import { HoldModelViewer } from './hold-model-viewer';
import { useHoldCapture } from './use-hold-capture';

export function AttachHoldModelDialog(props: {
  specification: HoldSpecification;
  onClose: () => void;
  onCompleted: () => Promise<void>;
}) {
  const capture = useHoldCapture(() => createHoldModelAttachment(props.specification.id));

  async function close(): Promise<void> {
    capture.setMessage('');
    try {
      await capture.cancel();
      props.onClose();
    } catch (error) {
      capture.setMessage(error instanceof Error ? error.message : '采集草稿取消失败');
    }
  }

  async function complete(): Promise<void> {
    if (!capture.draftId || !capture.modelAsset) {
      capture.setMessage('请先上传原始 3D 扫描模型');
      return;
    }
    capture.setMessage('');
    try {
      await completeHoldModelAttachment(capture.draftId);
      await props.onCompleted();
      props.onClose();
    } catch (error) {
      capture.setMessage(error instanceof Error ? error.message : '三维模型关联失败');
    }
  }

  return (
    <DialogShell
      title="补充 3D 扫描"
      description={`模型将直接关联到“${props.specification.productName} · ${climbingColorLabel(props.specification.color)}”，库存和流水不会改变。`}
      onClose={() => void close()}
      wide
    >
      <div className="hold-record-dialog">
        <HoldCaptureFields
          modelAsset={capture.modelAsset}
          photoCount={capture.photos.length}
          uploading={capture.uploading}
          modelProcessing={capture.modelProcessing}
          onModel={capture.uploadModel}
          onPhotos={capture.uploadPhotos}
        />
        {capture.modelAsset && <HoldModelViewer asset={capture.modelAsset} />}
        <footer className="hold-capture-footer">
          <button type="button" onClick={() => void close()}>
            取消
          </button>
          <button
            className="is-primary"
            disabled={!capture.modelAsset || capture.uploading}
            onClick={() => void complete()}
            type="button"
          >
            关联到当前档案
          </button>
        </footer>
        {capture.message && <p className="team-feedback is-error">{capture.message}</p>}
      </div>
    </DialogShell>
  );
}
