'use client';

import { useEffect, useRef, useState } from 'react';
import { recordStockMovement, type HoldSpecification, type InventoryBucket } from './hold-api';
import { bucketLabel } from './hold-options';
import { calculateInventoryAdjustment, stepTargetQuantity } from './hold-stock-adjustment';

type StockMode = 'RECEIPT' | 'ADJUSTMENT';

interface StockFormProps {
  specification: HoldSpecification;
  canAdjust: boolean;
  onChanged: () => Promise<void>;
}

export function HoldStockForm(props: StockFormProps) {
  const [mode, setMode] = useState<StockMode>('RECEIPT');
  return (
    <div className="hold-stock-control">
      <StockModeTabs mode={mode} canAdjust={props.canAdjust} onChange={setMode} />
      {mode === 'RECEIPT' ? (
        <ReceiptForm specification={props.specification} onChanged={props.onChanged} />
      ) : (
        <AdjustmentForm specification={props.specification} onChanged={props.onChanged} />
      )}
    </div>
  );
}

function StockModeTabs(props: {
  mode: StockMode;
  canAdjust: boolean;
  onChange: (mode: StockMode) => void;
}) {
  return (
    <nav>
      <button
        className={props.mode === 'RECEIPT' ? 'is-active' : ''}
        onClick={() => props.onChange('RECEIPT')}
      >
        到货入库
      </button>
      {props.canAdjust && (
        <button
          className={props.mode === 'ADJUSTMENT' ? 'is-active' : ''}
          onClick={() => props.onChange('ADJUSTMENT')}
        >
          调整库存
        </button>
      )}
    </nav>
  );
}

function ReceiptForm(props: Pick<StockFormProps, 'specification' | 'onChanged'>) {
  const [quantity, setQuantity] = useState('1');
  const [message, setMessage] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const request = useRef(createRequestState());

  async function submit(event: React.FormEvent): Promise<void> {
    event.preventDefault();
    const afterQuantity = props.specification.inventory.warehouseQuantity + Number(quantity);
    if (!window.confirm(`入库后仓库数量将变为 ${afterQuantity} 件，确认继续？`)) return;
    setSubmitting(true);
    setMessage('');
    try {
      const requestKey = keyForPayload(request.current, quantity);
      await recordStockMovement(props.specification.id, {
        requestKey,
        type: 'RECEIPT',
        bucket: 'WAREHOUSE',
        quantityDelta: Number(quantity),
      });
      await props.onChanged();
      resetRequestState(request.current);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : '入库失败');
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <form className="hold-receipt-form" onSubmit={submit}>
      <input
        aria-label="入库数量"
        required
        min="1"
        max="100000"
        type="number"
        value={quantity}
        onChange={(event) => setQuantity(event.target.value)}
      />
      <button disabled={submitting} type="submit">
        {submitting ? '处理中…' : '确认入库'}
      </button>
      {message && <p>{message}</p>}
    </form>
  );
}

function AdjustmentForm(props: Pick<StockFormProps, 'specification' | 'onChanged'>) {
  const form = useAdjustmentForm(props);
  return (
    <form className="hold-adjustment-form" onSubmit={form.submit}>
      <label className="hold-adjustment-location">
        <span>调整位置</span>
        <select
          aria-label="调整位置"
          value={form.bucket}
          onChange={(event) => form.selectBucket(event.target.value as InventoryBucket)}
        >
          {Object.entries(bucketLabel).map(([value, label]) => (
            <option key={value} value={value}>
              {label}
            </option>
          ))}
        </select>
      </label>
      <div className="hold-current-quantity">
        <span>当前数量</span>
        <strong>{form.currentQuantity} 件</strong>
      </div>
      <TargetQuantityField value={form.targetQuantity} onChange={form.setTargetQuantity} />
      <AdjustmentPreview currentQuantity={form.currentQuantity} result={form.adjustment} />
      <label className="hold-adjustment-reason">
        <span>调整原因</span>
        <input
          aria-label="调整原因"
          required
          maxLength={200}
          placeholder="例如：现场重新清点"
          value={form.note}
          onChange={(event) => form.setNote(event.target.value)}
        />
      </label>
      <button className="hold-adjustment-submit" disabled={!form.canSubmit} type="submit">
        {form.submitting ? '处理中…' : '确认调整'}
      </button>
      {form.message && <p>{form.message}</p>}
    </form>
  );
}

function TargetQuantityField(props: { value: string; onChange: (value: string) => void }) {
  return (
    <label className="hold-target-quantity">
      <span>盘点后的实际数量</span>
      <div className="hold-quantity-stepper">
        <button
          aria-label="减少实际数量"
          type="button"
          onClick={() => props.onChange(stepTargetQuantity(props.value, -1))}
        >
          −
        </button>
        <input
          aria-label="盘点后的实际数量"
          inputMode="numeric"
          min="0"
          max="100000"
          type="number"
          value={props.value}
          onChange={(event) => props.onChange(event.target.value)}
        />
        <button
          aria-label="增加实际数量"
          type="button"
          onClick={() => props.onChange(stepTargetQuantity(props.value, 1))}
        >
          +
        </button>
      </div>
    </label>
  );
}

function AdjustmentPreview(props: {
  currentQuantity: number;
  result: ReturnType<typeof calculateInventoryAdjustment>;
}) {
  if (!props.result.valid)
    return <p className="hold-adjustment-preview is-error">{props.result.error}</p>;
  return (
    <p className={`hold-adjustment-preview is-${props.result.tone}`}>
      从 {props.currentQuantity} 件调整为 {props.result.targetQuantity} 件
      <strong>{props.result.changeText}</strong>
    </p>
  );
}

function useAdjustmentForm(props: Pick<StockFormProps, 'specification' | 'onChanged'>) {
  const [bucket, setBucket] = useState<InventoryBucket>('WAREHOUSE');
  const current = currentQuantity(props.specification, bucket);
  const [target, setTarget] = useState(String(current));
  const [note, setNote] = useState('');
  const [message, setMessage] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const request = useRef(createRequestState());
  const adjustment = calculateInventoryAdjustment(current, target);

  useEffect(() => setTarget(String(current)), [current, props.specification.inventory.version]);
  async function submit(event: React.FormEvent): Promise<void> {
    event.preventDefault();
    if (!adjustment.valid || !adjustment.quantityDelta || !note.trim()) return;
    const confirmation = `${bucketLabel[bucket]}库存将从 ${current} 件调整为 ${adjustment.targetQuantity} 件（${adjustment.changeText}）。确认调整？`;
    if (!window.confirm(confirmation)) return;
    setSubmitting(true);
    setMessage('');
    try {
      const payloadKey = [
        bucket,
        adjustment.targetQuantity,
        note.trim(),
        props.specification.inventory.version,
      ].join('|');
      const requestKey = keyForPayload(request.current, payloadKey);
      await recordStockMovement(props.specification.id, {
        requestKey,
        type: 'ADJUSTMENT',
        bucket,
        targetQuantity: adjustment.targetQuantity,
        expectedVersion: props.specification.inventory.version,
        note: note.trim(),
      });
      await props.onChanged();
      resetRequestState(request.current);
      setNote('');
    } catch (error) {
      setMessage(error instanceof Error ? error.message : '库存调整失败');
    } finally {
      setSubmitting(false);
    }
  }
  function selectBucket(next: InventoryBucket): void {
    setBucket(next);
    setTarget(String(currentQuantity(props.specification, next)));
  }
  return {
    bucket,
    selectBucket,
    currentQuantity: current,
    targetQuantity: target,
    setTargetQuantity: setTarget,
    note,
    setNote,
    message,
    submitting,
    adjustment,
    canSubmit:
      adjustment.valid && Boolean(adjustment.quantityDelta) && Boolean(note.trim()) && !submitting,
    submit,
  };
}

function currentQuantity(specification: HoldSpecification, bucket: InventoryBucket): number {
  const fields: Record<InventoryBucket, keyof HoldSpecification['inventory']> = {
    WAREHOUSE: 'warehouseQuantity',
    INSTALLED: 'installedQuantity',
    RESERVED: 'reservedQuantity',
    MAINTENANCE: 'maintenanceQuantity',
  };
  return Number(specification.inventory[fields[bucket]]);
}

interface RequestState {
  key: string;
  payloadKey: string;
}

function createRequestState(): RequestState {
  return { key: crypto.randomUUID(), payloadKey: '' };
}

function keyForPayload(state: RequestState, payloadKey: string): string {
  if (state.payloadKey && state.payloadKey !== payloadKey) state.key = crypto.randomUUID();
  state.payloadKey = payloadKey;
  return state.key;
}

function resetRequestState(state: RequestState): void {
  state.key = crypto.randomUUID();
  state.payloadKey = '';
}
