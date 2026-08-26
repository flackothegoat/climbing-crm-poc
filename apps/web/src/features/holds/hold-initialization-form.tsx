'use client';

import { useState, type FormEvent } from 'react';
import {
  initializeHoldSpecification,
  type HoldInitializationBatch,
  type HoldSpecification,
} from './hold-api';

export function HoldInitializationForm(props: {
  batch: HoldInitializationBatch;
  specification: HoldSpecification;
  onChanged: () => Promise<void>;
}) {
  const inventory = props.specification.inventory;
  const [warehouse, setWarehouse] = useState(String(inventory.warehouseQuantity));
  const [installed, setInstalled] = useState(String(inventory.installedQuantity));
  const [note, setNote] = useState('');
  const [message, setMessage] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const completed = props.batch.specificationIds.includes(props.specification.id);

  async function submit(event: FormEvent): Promise<void> {
    event.preventDefault();
    const counts = parseObservedCounts(warehouse, installed, note);
    if (!window.confirm(buildConfirmation(counts.warehouseQuantity, counts.installedQuantity)))
      return;
    setSubmitting(true);
    setMessage('');
    try {
      await initializeHoldSpecification(props.specification.id, props.batch.id, counts);
      await props.onChanged();
    } catch (error) {
      setMessage(error instanceof Error ? error.message : '盘点实数登记失败');
    } finally {
      setSubmitting(false);
    }
  }

  if (completed) {
    return <p className="hold-initialization-complete">本次盘点已记录</p>;
  }

  return (
    <form className="hold-existing-initialization" onSubmit={submit}>
      <div>
        <b>现场盘点实数</b>
        <small>这是当前现实快照，不是新增到货数量。</small>
      </div>
      <label>
        仓库
        <input
          min="0"
          required
          type="number"
          value={warehouse}
          onChange={(event) => setWarehouse(event.target.value)}
        />
      </label>
      <label>
        已上墙
        <input
          min="0"
          required
          type="number"
          value={installed}
          onChange={(event) => setInstalled(event.target.value)}
        />
      </label>
      <input
        aria-label="盘点备注"
        maxLength={200}
        placeholder="盘点备注（可选）"
        value={note}
        onChange={(event) => setNote(event.target.value)}
      />
      <button disabled={submitting}>{submitting ? '登记中…' : '确认现场实数'}</button>
      {message && <p>{message}</p>}
    </form>
  );
}

function parseObservedCounts(warehouse: string, installed: string, note: string) {
  const warehouseQuantity = Number(warehouse);
  const installedQuantity = Number(installed);
  if (!isCount(warehouseQuantity) || !isCount(installedQuantity)) {
    throw new Error('仓库和已上墙实数必须是非负整数');
  }
  if (warehouseQuantity + installedQuantity < 1) throw new Error('同组岩点总数至少为 1');
  return { warehouseQuantity, installedQuantity, note: note.trim() || null };
}

function buildConfirmation(warehouse: number, installed: number): string {
  return `将数量更新为：仓库 ${warehouse} 颗，已上墙 ${installed} 颗。原记录保留，确认继续？`;
}

function isCount(value: number): boolean {
  return Number.isInteger(value) && value >= 0;
}
