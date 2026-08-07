'use client';

import { useState } from 'react';
import { DialogShell } from '../common/dialog-shell';
import { permanentlyDeleteHoldSpecification, type HoldSpecification } from './hold-api';
import { bucketLabel } from './hold-options';

const requiredConfirmation = '删除';

export function DeleteHoldRecordDialog(props: {
  specification: HoldSpecification;
  onClose: () => void;
  onDeleted: () => Promise<void>;
}) {
  const [reason, setReason] = useState('');
  const [confirmationText, setConfirmationText] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [message, setMessage] = useState('');
  const canSubmit = canConfirmPermanentDeletion(reason, confirmationText) && !submitting;

  async function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!canSubmit) return;
    setSubmitting(true);
    setMessage('');
    try {
      await permanentlyDeleteHoldSpecification(props.specification.id, {
        expectedVersion: props.specification.inventory.version,
        reason: reason.trim(),
        confirmationText: confirmationText.trim(),
      });
      props.onClose();
      await props.onDeleted();
    } catch (error) {
      setMessage(error instanceof Error ? error.message : '删除失败，请稍后重试');
      setSubmitting(false);
    }
  }

  return (
    <DialogShell
      title="永久删除岩点档案"
      description={`${props.specification.productName} · ${props.specification.colorName}`}
      onClose={submitting ? () => undefined : props.onClose}
    >
      <form className="dialog-form hold-delete-form" onSubmit={submit}>
        <DeletionWarning specification={props.specification} />
        <label>
          删除原因
          <textarea
            maxLength={200}
            placeholder="例如：现场数量录错，重新建档"
            rows={3}
            value={reason}
            onChange={(event) => setReason(event.target.value)}
          />
        </label>
        <label>
          输入“删除”确认
          <input
            autoComplete="off"
            value={confirmationText}
            onChange={(event) => setConfirmationText(event.target.value)}
          />
        </label>
        {message && <p className="dialog-message is-error">{message}</p>}
        <footer>
          <button
            className="dialog-secondary"
            disabled={submitting}
            type="button"
            onClick={props.onClose}
          >
            取消
          </button>
          <button className="dialog-danger" disabled={!canSubmit} type="submit">
            {submitting ? '正在删除…' : '永久删除并清零'}
          </button>
        </footer>
      </form>
    </DialogShell>
  );
}

function DeletionWarning({ specification }: { specification: HoldSpecification }) {
  const inventory = specification.inventory;
  const buckets = [
    ['WAREHOUSE', inventory.warehouseQuantity],
    ['INSTALLED', inventory.installedQuantity],
    ['RESERVED', inventory.reservedQuantity],
    ['MAINTENANCE', inventory.maintenanceQuantity],
  ] as const;
  const modelCount = specification.assets.filter((asset) => asset.kind === 'MODEL_3D').length;
  const photoCount = specification.assets.length - modelCount;
  return (
    <section className="hold-delete-warning">
      <strong>删除后，这个档案不会再出现在系统中，也无法自行恢复。</strong>
      <p>系统会清零以下库存，并保留删除前快照和清零记录供审计。</p>
      <dl>
        {buckets.map(([bucket, quantity]) => (
          <div key={bucket}>
            <dt>{bucketLabel[bucket]}</dt>
            <dd>{quantity} 件</dd>
          </div>
        ))}
        <div>
          <dt>关联文件</dt>
          <dd>
            {modelCount} 个模型 · {photoCount} 张照片
          </dd>
        </div>
      </dl>
    </section>
  );
}

export function canConfirmPermanentDeletion(reason: string, confirmationText: string): boolean {
  return reason.trim().length >= 2 && confirmationText.trim() === requiredConfirmation;
}
