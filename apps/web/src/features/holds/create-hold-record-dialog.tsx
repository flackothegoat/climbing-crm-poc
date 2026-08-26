'use client';

import { useEffect, useState } from 'react';
import { DialogShell } from '../common/dialog-shell';
import {
  createHoldRecord,
  createNewHoldCapture,
  finalizeHoldScan,
  getHoldCategories,
  type HoldCategory,
  type HoldInitializationBatch,
  type HoldSpecificationInput,
} from './hold-api';
import { gripEnglishLabel } from './hold-options';
import { HoldCaptureFields } from './hold-capture-fields';
import { HoldModelViewer } from './hold-model-viewer';
import {
  HoldObservedCounts,
  parseObservedCounts,
  type ObservedCountState,
} from './hold-observed-counts';
import { HoldSpecificationForm } from './hold-specification-form';
import { useHoldCapture } from './use-hold-capture';

type CreationMethod = 'SCAN' | 'MANUAL';

export function CreateHoldRecordDialog(props: {
  batch: HoldInitializationBatch | null;
  initialCategoryId?: string;
  onClose: () => void;
  onCompleted: () => Promise<void>;
}) {
  const [categories, setCategories] = useState<HoldCategory[]>([]);
  const [categoryId, setCategoryId] = useState(props.initialCategoryId ?? '');
  const [method, setMethod] = useState<CreationMethod>('SCAN');
  const [counts, setCounts] = useState<ObservedCountState>(emptyCounts);
  const [message, setMessage] = useState('');
  const capture = useHoldCapture(async () => {
    if (!categoryId) throw new Error('请选择抓握用途');
    return createNewHoldCapture(categoryId, props.batch?.id);
  });

  useEffect(() => {
    void loadCategories(props.initialCategoryId, setCategories, setCategoryId, setMessage);
  }, [props.initialCategoryId]);

  async function submitManual(specification: HoldSpecificationInput): Promise<void> {
    if (!categoryId) throw new Error('请选择抓握用途');
    const initialization = props.batch
      ? { batchId: props.batch.id, ...parseObservedCounts(counts) }
      : undefined;
    await createHoldRecord(categoryId, specification, initialization);
    await finish();
  }

  async function submitScan(specification: HoldSpecificationInput): Promise<void> {
    if (!capture.draftId || !capture.modelAsset) throw new Error('请先上传原始 3D 扫描模型');
    const inventory = props.batch ? parseObservedCounts(counts) : undefined;
    await finalizeHoldScan(capture.draftId, specification, inventory);
    await finish();
  }

  async function finish(): Promise<void> {
    await props.onCompleted();
    props.onClose();
  }

  async function close(): Promise<void> {
    setMessage('');
    try {
      await capture.cancel();
      props.onClose();
    } catch (error) {
      setMessage(toMessage(error, '采集草稿取消失败，请稍后重试'));
    }
  }

  return (
    <DialogShell
      title="新增岩点档案"
      description="扫描和手工录入最终都会生成同一种岩点档案。"
      onClose={() => void close()}
      wide
    >
      <div className="hold-record-dialog">
        <RecordSetup
          categories={categories}
          categoryId={categoryId}
          locked={Boolean(capture.draftId)}
          method={method}
          onCategory={setCategoryId}
          onMethod={setMethod}
        />
        {method === 'SCAN' && (
          <ScanCreation
            capture={capture}
            counts={counts}
            hasBatch={Boolean(props.batch)}
            onCancel={() => void close()}
            onCounts={setCounts}
            onSubmit={submitScan}
          />
        )}
        {method === 'MANUAL' && (
          <ManualCreation
            counts={counts}
            hasBatch={Boolean(props.batch)}
            onCancel={() => void close()}
            onCounts={setCounts}
            onSubmit={submitManual}
          />
        )}
        {(message || capture.message) && (
          <p className="team-feedback is-error">{message || capture.message}</p>
        )}
      </div>
    </DialogShell>
  );
}

function RecordSetup(props: {
  categories: HoldCategory[];
  categoryId: string;
  locked: boolean;
  method: CreationMethod;
  onCategory: (value: string) => void;
  onMethod: (value: CreationMethod) => void;
}) {
  return (
    <section className="hold-record-setup">
      <label>
        抓握用途
        <select
          disabled={props.locked}
          value={props.categoryId}
          onChange={(event) => props.onCategory(event.target.value)}
        >
          {props.categories.map((category) => (
            <option key={category.id} value={category.id}>
              {category.name} · {gripEnglishLabel[category.gripType]}
            </option>
          ))}
        </select>
      </label>
      <div className="hold-method-selector" aria-label="建档方式">
        <button
          className={props.method === 'SCAN' ? 'is-active' : ''}
          disabled={props.locked}
          onClick={() => props.onMethod('SCAN')}
          type="button"
        >
          <b>扫描建档</b>
          <small>上传 GLB，实物优先辨识</small>
        </button>
        <button
          className={props.method === 'MANUAL' ? 'is-active' : ''}
          disabled={props.locked}
          onClick={() => props.onMethod('MANUAL')}
          type="button"
        >
          <b>手工建档</b>
          <small>以后可以补充 3D 模型</small>
        </button>
      </div>
      {props.locked && <small>文件上传后用途和建档方式已锁定，避免资产关联错误。</small>}
    </section>
  );
}

function ScanCreation(props: {
  capture: ReturnType<typeof useHoldCapture>;
  counts: ObservedCountState;
  hasBatch: boolean;
  onCancel: () => void;
  onCounts: (value: ObservedCountState) => void;
  onSubmit: (input: HoldSpecificationInput) => Promise<void>;
}) {
  return (
    <>
      <HoldCaptureFields
        modelAsset={props.capture.modelAsset}
        photoCount={props.capture.photos.length}
        uploading={props.capture.uploading}
        modelProcessing={props.capture.modelProcessing}
        onModel={props.capture.uploadModel}
        onPhotos={props.capture.uploadPhotos}
      />
      {props.capture.modelAsset && <HoldModelViewer asset={props.capture.modelAsset} />}
      {props.capture.modelAsset && props.hasBatch && (
        <HoldObservedCounts value={props.counts} onChange={props.onCounts} />
      )}
      {props.capture.modelAsset && (
        <HoldSpecificationForm
          context="scan"
          submitLabel={props.hasBatch ? '创建档案并登记数量' : '创建零数量档案'}
          onCancel={props.onCancel}
          onSubmit={props.onSubmit}
        />
      )}
    </>
  );
}

function ManualCreation(props: {
  counts: ObservedCountState;
  hasBatch: boolean;
  onCancel: () => void;
  onCounts: (value: ObservedCountState) => void;
  onSubmit: (input: HoldSpecificationInput) => Promise<void>;
}) {
  return (
    <>
      {!props.hasBatch && (
        <p className="hold-record-note">先建立零数量档案；创建后可在档案详情新增数量并补充 3D。</p>
      )}
      {props.hasBatch && <HoldObservedCounts value={props.counts} onChange={props.onCounts} />}
      <HoldSpecificationForm
        context="manual"
        submitLabel={props.hasBatch ? '创建档案并登记数量' : '创建零数量档案'}
        onCancel={props.onCancel}
        onSubmit={props.onSubmit}
      />
    </>
  );
}

async function loadCategories(
  initialCategoryId: string | undefined,
  setCategories: (items: HoldCategory[]) => void,
  setCategoryId: (id: string) => void,
  setMessage: (message: string) => void,
): Promise<void> {
  try {
    const result = await getHoldCategories('', '', false);
    setCategories(result.items);
    setCategoryId(initialCategoryId ?? result.items[0]?.id ?? '');
  } catch (error) {
    setMessage(toMessage(error, '抓握用途加载失败'));
  }
}

const emptyCounts: ObservedCountState = { warehouse: '0', installed: '0', note: '' };
const toMessage = (error: unknown, fallback: string) =>
  error instanceof Error ? error.message : fallback;
