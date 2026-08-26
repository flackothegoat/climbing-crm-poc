'use client';

import { useState } from 'react';
import {
  restoreHoldSpecification,
  stopHoldSpecification,
  type HoldSpecification,
} from './hold-api';
import { DeleteHoldRecordDialog } from './delete-hold-record-dialog';

export function HoldSpecificationActions(props: {
  specification: HoldSpecification;
  categoryActive: boolean;
  onChanged: () => Promise<void>;
  onDeleted?: () => Promise<void>;
}) {
  const [message, setMessage] = useState('');
  const [deleteOpen, setDeleteOpen] = useState(false);

  async function run(action: () => Promise<void>, confirmation: string): Promise<void> {
    if (!window.confirm(confirmation)) return;
    setMessage('');
    try {
      await action();
      await props.onChanged();
    } catch (error) {
      setMessage(error instanceof Error ? error.message : '档案操作失败');
    }
  }

  const lifecycle = props.specification.lifecycle;
  if (!lifecycle) return null;
  return (
    <div className="hold-variant-actions">
      {lifecycle.canRestore ? (
        <button
          disabled={!props.categoryActive}
          onClick={() =>
            run(() => restoreHoldSpecification(props.specification.id), '恢复这个岩点档案？')
          }
        >
          恢复档案
        </button>
      ) : (
        <button
          disabled={!lifecycle.canStop}
          onClick={() =>
            run(
              () => stopHoldSpecification(props.specification.id),
              '停用后不再允许入库或用于换线，确定继续？',
            )
          }
        >
          停用档案
        </button>
      )}
      <button className="is-danger" onClick={() => setDeleteOpen(true)}>
        永久删除
      </button>
      {message && <small>{message}</small>}
      {deleteOpen && (
        <DeleteHoldRecordDialog
          specification={props.specification}
          onClose={() => setDeleteOpen(false)}
          onDeleted={props.onDeleted ?? props.onChanged}
        />
      )}
    </div>
  );
}
