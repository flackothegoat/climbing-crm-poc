'use client';

import {
  createElement,
  useCallback,
  useEffect,
  useRef,
  useState,
  type MutableRefObject,
} from 'react';
import Image from 'next/image';
import {
  getHoldAssetBlob,
  getHoldModelProcessing,
  retryHoldModelProcessing,
  uploadHoldModelPreview,
  type HoldAsset,
  type HoldModelProcessingJob,
} from './hold-api';
import { createPreviewFile, findModelPreview, holdModelPreviewConfig } from './hold-model-preview';

interface HoldModelViewerProps {
  asset: HoldAsset;
  compact?: boolean;
  previewAttempt?: number;
  onPreviewGenerated?: (blob: Blob) => Promise<void>;
  onPreviewError?: (error: unknown) => void;
}

interface ModelViewerElement extends HTMLElement {
  loaded: boolean;
  jumpCameraToGoal?: () => void;
  toBlob: (options: {
    mimeType: string;
    qualityArgument: number;
    idealAspect: boolean;
  }) => Promise<Blob>;
}

type PreviewState = 'GENERATING' | 'UPLOADING' | 'READY' | 'FAILED';

export function HoldModelViewer(props: HoldModelViewerProps) {
  useModelViewerRegistration();
  const assetSource = useAssetSource(props.asset.id);
  const viewerRef = usePreviewCapture(props, assetSource.source);
  if (assetSource.error) return <p className="hold-model-error">{assetSource.error}</p>;
  if (!assetSource.source) return <div className="hold-model-loading">正在加载 3D 岩点…</div>;
  const previewView = props.compact || Boolean(props.onPreviewGenerated);
  const controls = props.compact ? {} : { 'camera-controls': '' };
  return createElement('model-viewer', {
    ref: viewerRef,
    src: assetSource.source,
    alt: `岩点 3D 模型：${props.asset.originalFileName}`,
    className: props.compact ? 'hold-model-viewer is-compact' : 'hold-model-viewer',
    loading: 'lazy',
    'shadow-intensity': '0.8',
    exposure: '1',
    ...(previewView ? previewCameraAttributes : {}),
    ...controls,
  });
}

function useModelViewerRegistration(): void {
  useEffect(() => {
    void import('@google/model-viewer');
  }, []);
}

export function HoldAssetGallery({ assets }: { assets: HoldAsset[] }) {
  const model = assets.find((asset) => asset.kind === 'MODEL_3D' && asset.status === 'READY');
  if (!model) {
    const source = assets.find(
      (asset) => asset.kind === 'MODEL_SOURCE' && asset.status === 'READY',
    );
    return source ? <ModelProcessingCard source={source} /> : null;
  }
  return <ModelAssetGallery assets={assets} model={model} />;
}

function ModelProcessingCard({ source }: { source: HoldAsset }) {
  const [job, setJob] = useState(source.processingJob ?? null);
  const [retrying, setRetrying] = useState(false);
  const [error, setError] = useState('');
  useEffect(() => {
    if (!job || !['QUEUED', 'PROCESSING'].includes(job.status)) return;
    const timer = window.setInterval(() => {
      void getHoldModelProcessing(source.scanId)
        .then(setJob)
        .catch(() => undefined);
    }, 2_000);
    return () => window.clearInterval(timer);
  }, [job, source.scanId]);
  useEffect(() => {
    if (job?.status === 'COMPLETED' || job?.status === 'NEEDS_REVIEW') {
      window.location.reload();
    }
  }, [job?.status]);
  if (!job) return <p className="hold-record-note">原始扫描已保存，等待后台任务同步。</p>;
  return (
    <section className="hold-asset-gallery">
      <div>
        <b>3D 展示模型</b>
        <small>{processingText(job)}</small>
        {job.errorMessage && <small>{job.errorMessage}</small>}
        {error && <small className="is-error">{error}</small>}
      </div>
      {job.status === 'FAILED' && (
        <button
          disabled={retrying}
          onClick={() => void retryProcessing(job, setJob, setRetrying, setError)}
          type="button"
        >
          {retrying ? '重新排队中…' : '重试自动清理'}
        </button>
      )}
    </section>
  );
}

function processingText(job: HoldModelProcessingJob): string {
  if (job.status === 'QUEUED') return '已排队；不影响库存档案使用';
  if (job.status === 'PROCESSING') return '后台正在移除桌面和扫描杂面';
  if (job.status === 'NEEDS_REVIEW') return '模型已生成，等待人工复核';
  if (job.status === 'FAILED') return '自动清理失败；原始模型仍完整保留';
  if (job.status === 'CANCELLED') return '处理任务已取消';
  return '展示模型已生成';
}

async function retryProcessing(
  job: HoldModelProcessingJob,
  setJob: (job: HoldModelProcessingJob) => void,
  setRetrying: (value: boolean) => void,
  setError: (value: string) => void,
): Promise<void> {
  setRetrying(true);
  setError('');
  try {
    setJob(await retryHoldModelProcessing(job.id));
  } catch (requestError) {
    setError(toMessage(requestError, '重新排队失败'));
  } finally {
    setRetrying(false);
  }
}

function ModelAssetGallery(props: { assets: HoldAsset[]; model: HoldAsset }) {
  const preview = useStoredModelPreview(props.assets, props.model);
  const [open, setOpen] = useState(false);
  return (
    <>
      <section className="hold-asset-gallery">
        <div className="hold-model-preview">
          <PreviewSurface
            attempt={preview.attempt}
            model={props.model}
            preview={preview.asset}
            state={preview.state}
            onFailed={preview.fail}
            onGenerated={preview.save}
            onRetry={preview.retry}
          />
          <button
            aria-label={`放大查看 ${props.model.originalFileName}`}
            onClick={() => setOpen(true)}
          >
            放大查看
          </button>
        </div>
        <ModelAssetSummary model={props.model} previewState={preview.state} />
      </section>
      {open && <HoldModelDialog asset={props.model} onClose={() => setOpen(false)} />}
    </>
  );
}

function useStoredModelPreview(assets: HoldAsset[], model: HoldAsset) {
  const stored = findModelPreview(assets, model.id);
  const [asset, setAsset] = useState<HoldAsset | null>(stored);
  const [state, setState] = useState<PreviewState>(stored ? 'READY' : 'GENERATING');
  const [attempt, setAttempt] = useState(0);
  useEffect(() => {
    setAsset(stored);
    setState(stored ? 'READY' : 'GENERATING');
  }, [model.id, stored]);
  const save = useCallback(
    async (blob: Blob) => {
      setState('UPLOADING');
      const file = createPreviewFile(blob, model.originalFileName);
      const uploaded = await uploadHoldModelPreview(
        model.id,
        holdModelPreviewConfig.generationVersion,
        file,
      );
      setAsset(uploaded);
      setState('READY');
    },
    [model],
  );
  const fail = useCallback(() => setState('FAILED'), []);
  const retry = useCallback(() => {
    setState('GENERATING');
    setAttempt((value) => value + 1);
  }, []);
  return { asset, attempt, fail, retry, save, state };
}

function PreviewSurface(props: {
  attempt: number;
  model: HoldAsset;
  preview: HoldAsset | null;
  state: PreviewState;
  onFailed: (error: unknown) => void;
  onGenerated: (blob: Blob) => Promise<void>;
  onRetry: () => void;
}) {
  if (props.preview) return <HoldModelThumbnail asset={props.preview} />;
  return (
    <div className="hold-preview-generation">
      <HoldModelViewer
        asset={props.model}
        compact
        previewAttempt={props.attempt}
        onPreviewError={props.onFailed}
        onPreviewGenerated={props.onGenerated}
      />
      <PreviewGenerationStatus state={props.state} onRetry={props.onRetry} />
    </div>
  );
}

function HoldModelThumbnail({ asset }: { asset: HoldAsset }) {
  const assetSource = useAssetSource(asset.id);
  if (assetSource.error) return <p className="hold-model-error">{assetSource.error}</p>;
  if (!assetSource.source) return <div className="hold-model-loading">正在加载俯瞰缩略图…</div>;
  return (
    <Image
      alt="岩点三维模型俯瞰缩略图"
      className="hold-model-thumbnail"
      height={holdModelPreviewConfig.height}
      src={assetSource.source}
      unoptimized
      width={holdModelPreviewConfig.width}
    />
  );
}

function PreviewGenerationStatus(props: { state: PreviewState; onRetry: () => void }) {
  if (props.state === 'FAILED') {
    return (
      <button className="hold-preview-retry" onClick={props.onRetry} type="button">
        缩略图生成失败，点击重试
      </button>
    );
  }
  const text = props.state === 'UPLOADING' ? '正在保存缩略图…' : '正在生成俯瞰缩略图…';
  return <span className="hold-preview-progress">{text}</span>;
}

function ModelAssetSummary(props: { model: HoldAsset; previewState: PreviewState }) {
  const status = props.previewState === 'READY' ? '俯瞰缩略图已生成' : '正在准备缩略图';
  return (
    <div>
      <b>3D 模型</b>
      <small>{props.model.originalFileName}</small>
      <small>{formatFileSize(props.model.sizeBytes)}</small>
      <small>{status}</small>
    </div>
  );
}

function HoldModelDialog(props: { asset: HoldAsset; onClose: () => void }) {
  useEffect(() => {
    const closeOnEscape = (event: KeyboardEvent) => event.key === 'Escape' && props.onClose();
    window.addEventListener('keydown', closeOnEscape);
    return () => window.removeEventListener('keydown', closeOnEscape);
  }, [props]);

  return (
    <div className="hold-model-dialog-backdrop" role="presentation" onMouseDown={props.onClose}>
      <section
        aria-modal="true"
        className="hold-model-dialog"
        role="dialog"
        onMouseDown={(event) => event.stopPropagation()}
      >
        <header>
          <div>
            <h3>查看 3D 岩点</h3>
            <p>按住鼠标拖动，可 360° 查看；滚轮缩放</p>
          </div>
          <button aria-label="关闭 3D 模型" onClick={props.onClose}>
            ×
          </button>
        </header>
        <HoldModelViewer asset={props.asset} />
      </section>
    </div>
  );
}

function useAssetSource(assetId: string) {
  const [source, setSource] = useState('');
  const [error, setError] = useState('');
  useEffect(() => {
    let objectUrl = '';
    let active = true;
    void getHoldAssetBlob(assetId)
      .then((blob) => {
        if (!active) return;
        objectUrl = URL.createObjectURL(blob);
        setSource(objectUrl);
      })
      .catch((requestError: unknown) => {
        if (active) setError(toMessage(requestError, '资产加载失败'));
      });
    return () => {
      active = false;
      if (objectUrl) URL.revokeObjectURL(objectUrl);
    };
  }, [assetId]);
  return { error, source };
}

function usePreviewCapture(props: HoldModelViewerProps, source: string) {
  const viewerRef = useRef<ModelViewerElement | null>(null);
  const callbacksRef = useRef({
    onGenerated: props.onPreviewGenerated,
    onError: props.onPreviewError,
  });
  const generatedKeyRef = useRef('');
  useEffect(() => {
    callbacksRef.current = {
      onGenerated: props.onPreviewGenerated,
      onError: props.onPreviewError,
    };
  }, [props.onPreviewError, props.onPreviewGenerated]);
  useEffect(() => {
    if (!source || !props.onPreviewGenerated || !viewerRef.current) return;
    const viewer = viewerRef.current;
    const generationKey = `${props.asset.id}:${props.previewAttempt ?? 0}`;
    let active = true;
    const generate = () =>
      void generatePreview(viewer, generationKey, generatedKeyRef, callbacksRef, () => active);
    viewer.addEventListener('load', generate, { once: true });
    if (viewer.loaded) generate();
    return () => {
      active = false;
      viewer.removeEventListener('load', generate);
    };
  }, [props.asset.id, props.onPreviewGenerated, props.previewAttempt, source]);
  return viewerRef;
}

async function generatePreview(
  viewer: ModelViewerElement,
  generationKey: string,
  generatedKeyRef: MutableRefObject<string>,
  callbacksRef: MutableRefObject<{
    onGenerated?: (blob: Blob) => Promise<void>;
    onError?: (error: unknown) => void;
  }>,
  isActive: () => boolean,
): Promise<void> {
  if (generatedKeyRef.current === generationKey) return;
  generatedKeyRef.current = generationKey;
  try {
    const preview = await capturePreviewBlob(viewer);
    if (isActive()) await callbacksRef.current.onGenerated?.(preview);
  } catch (error) {
    generatedKeyRef.current = '';
    if (isActive()) callbacksRef.current.onError?.(error);
  }
}

async function capturePreviewBlob(viewer: ModelViewerElement): Promise<Blob> {
  viewer.jumpCameraToGoal?.();
  await waitForRender();
  const raw = await viewer.toBlob({
    mimeType: holdModelPreviewConfig.mimeType,
    qualityArgument: holdModelPreviewConfig.quality,
    idealAspect: false,
  });
  return resizePreviewBlob(raw);
}

async function resizePreviewBlob(source: Blob): Promise<Blob> {
  const image = await createImageBitmap(source);
  try {
    const canvas = document.createElement('canvas');
    canvas.width = holdModelPreviewConfig.width;
    canvas.height = holdModelPreviewConfig.height;
    const context = canvas.getContext('2d');
    if (!context) throw new Error('浏览器无法创建缩略图画布');
    context.fillStyle = '#f3f7f4';
    context.fillRect(0, 0, canvas.width, canvas.height);
    drawContainedImage(context, image, canvas.width, canvas.height);
    return canvasToWebp(canvas);
  } finally {
    image.close();
  }
}

function drawContainedImage(
  context: CanvasRenderingContext2D,
  image: ImageBitmap,
  width: number,
  height: number,
): void {
  const scale = Math.min(width / image.width, height / image.height);
  const drawWidth = image.width * scale;
  const drawHeight = image.height * scale;
  context.drawImage(
    image,
    (width - drawWidth) / 2,
    (height - drawHeight) / 2,
    drawWidth,
    drawHeight,
  );
}

function canvasToWebp(canvas: HTMLCanvasElement): Promise<Blob> {
  return new Promise((resolve, reject) => {
    canvas.toBlob(
      (blob) => (blob ? resolve(blob) : reject(new Error('浏览器无法导出 WebP 缩略图'))),
      holdModelPreviewConfig.mimeType,
      holdModelPreviewConfig.quality,
    );
  });
}

function waitForRender(): Promise<void> {
  return new Promise((resolve) =>
    requestAnimationFrame(() => requestAnimationFrame(() => resolve())),
  );
}

const previewCameraAttributes = {
  'camera-orbit': holdModelPreviewConfig.cameraOrbit,
  'camera-target': holdModelPreviewConfig.cameraTarget,
  'field-of-view': holdModelPreviewConfig.fieldOfView,
};

const toMessage = (error: unknown, fallback: string) =>
  error instanceof Error ? error.message : fallback;

function formatFileSize(sizeBytes: number): string {
  return `${(sizeBytes / 1024 / 1024).toFixed(1)} MB`;
}
