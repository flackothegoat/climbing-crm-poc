'use client';

import { useState, type FormEvent } from 'react';
import type { HoldInitializationBatch } from './hold-api';

export function HoldInitializationPanel(props: {
  batch: HoldInitializationBatch | null;
  loading: boolean;
  onStart: (name: string) => Promise<void>;
  onComplete: () => Promise<void>;
  onCancel: () => Promise<void>;
  onAddRecord: () => void;
}) {
  return props.batch ? (
    <ActiveInitialization
      batch={props.batch}
      onCancel={props.onCancel}
      onComplete={props.onComplete}
      onAddRecord={props.onAddRecord}
    />
  ) : (
    <StartInitialization loading={props.loading} onStart={props.onStart} />
  );
}

function StartInitialization(props: {
  loading: boolean;
  onStart: (name: string) => Promise<void>;
}) {
  const [name, setName] = useState(defaultBatchName);
  const [message, setMessage] = useState('');
  const [submitting, setSubmitting] = useState(false);

  async function submit(event: FormEvent): Promise<void> {
    event.preventDefault();
    setSubmitting(true);
    setMessage('');
    try {
      await props.onStart(name);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : '首次盘点创建失败');
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <section className="hold-initialization-panel">
      <div>
        <span>库存工具</span>
        <h3>首次盘点</h3>
        <p>新场馆第一次录入库存时使用，平时直接新增岩点即可。</p>
      </div>
      <form onSubmit={submit}>
        <input
          aria-label="盘点名称"
          maxLength={80}
          required
          value={name}
          onChange={(event) => setName(event.target.value)}
        />
        <button disabled={submitting || props.loading}>
          {submitting ? '创建中…' : '开始盘点'}
        </button>
        {message && <small>{message}</small>}
      </form>
    </section>
  );
}

function ActiveInitialization(props: {
  batch: HoldInitializationBatch;
  onComplete: () => Promise<void>;
  onCancel: () => Promise<void>;
  onAddRecord: () => void;
}) {
  const [message, setMessage] = useState('');
  async function complete(): Promise<void> {
    if (!window.confirm('结束后不能继续添加本次盘点记录，确定完成？')) return;
    setMessage('');
    try {
      await props.onComplete();
    } catch (error) {
      setMessage(error instanceof Error ? error.message : '盘点完成失败');
    }
  }

  async function cancel(): Promise<void> {
    if (!window.confirm('确定取消这次空盘点？')) return;
    setMessage('');
    try {
      await props.onCancel();
    } catch (error) {
      setMessage(error instanceof Error ? error.message : '盘点取消失败');
    }
  }
  return (
    <section className="hold-initialization-panel is-active">
      <div>
        <span>正在盘点</span>
        <h3>{props.batch.name}</h3>
        <p>
          已确认 {props.batch.entryCount} 组 · 仓库 {props.batch.warehouseQuantity} 件 · 已上墙{' '}
          {props.batch.installedQuantity} 件
        </p>
        {props.batch.draftScanCount > 0 && (
          <small>{props.batch.draftScanCount} 个扫描草稿待完成</small>
        )}
        {message && <small className="is-error">{message}</small>}
      </div>
      <div className="hold-initialization-actions">
        <button className="is-primary" onClick={props.onAddRecord}>
          录入岩点
        </button>
        <button onClick={complete}>完成盘点</button>
        {!props.batch.entryCount && !props.batch.draftScanCount && (
          <button className="is-danger" onClick={cancel}>
            取消盘点
          </button>
        )}
      </div>
    </section>
  );
}

function defaultBatchName(): string {
  return `${new Intl.DateTimeFormat('zh-CN', { year: 'numeric', month: 'long' }).format(new Date())}岩点盘点`;
}
