'use client';

import { useState } from 'react';
import { reverseReceipt, type HoldMovement } from './hold-api';

export function ReverseReceiptControl(props: {
  movement: HoldMovement;
  onChanged: () => Promise<void>;
}) {
  const [open, setOpen] = useState(false);
  const [reason, setReason] = useState('');
  const [message, setMessage] = useState('');
  const [submitting, setSubmitting] = useState(false);

  async function submit(event: React.FormEvent): Promise<void> {
    event.preventDefault();
    setSubmitting(true);
    setMessage('');
    try {
      await reverseReceipt(props.movement.id, reason);
      await props.onChanged();
    } catch (error) {
      setMessage(error instanceof Error ? error.message : '撤销入库失败');
    } finally {
      setSubmitting(false);
    }
  }

  if (!open) {
    return (
      <button className="movement-reverse-button" onClick={() => setOpen(true)}>
        撤销此笔入库
      </button>
    );
  }
  return (
    <form className="movement-reverse-form" onSubmit={submit}>
      <p>将从仓库扣减 {props.movement.quantityDelta} 件，原流水会永久保留。</p>
      <input
        required
        minLength={2}
        maxLength={200}
        placeholder="撤销原因"
        value={reason}
        onChange={(event) => setReason(event.target.value)}
      />
      <span>
        <button type="button" onClick={() => setOpen(false)}>
          取消
        </button>
        <button disabled={submitting} type="submit">
          {submitting ? '处理中…' : '确认撤销'}
        </button>
      </span>
      {message && <small>{message}</small>}
    </form>
  );
}
