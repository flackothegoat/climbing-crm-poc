'use client';

import { useCallback, useEffect, useState } from 'react';
import {
  bindHoldUnitTag,
  getHoldUnits,
  registerHoldUnits,
  type HoldSpecification,
  type HoldUnit,
  type HoldUnitListResponse,
} from './hold-api';

const trackingLabel = {
  QUANTITY: '仅统计数量',
  HYBRID: '部分已编号',
  SERIALIZED: '全部已编号',
} as const;

const physicalLabel = {
  WAREHOUSE: '仓库',
  INSTALLED: '已上墙',
  IN_TRANSIT: '运输中',
  UNKNOWN: '待确认',
} as const;

export function HoldUnitManager(props: {
  specification: HoldSpecification;
  disabled: boolean;
  onChanged: () => Promise<void>;
}) {
  const [data, setData] = useState<HoldUnitListResponse | null>(null);
  const [status, setStatus] = useState<'WAREHOUSE' | 'INSTALLED'>('WAREHOUSE');
  const [quantity, setQuantity] = useState(1);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  const load = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      setData(await getHoldUnits(props.specification.id));
    } catch (requestError) {
      setError(toMessage(requestError, '实物信息加载失败'));
    } finally {
      setLoading(false);
    }
  }, [props.specification.id]);

  useEffect(() => void load(), [load]);

  const remaining =
    status === 'WAREHOUSE'
      ? (data?.tracking.warehouseRemaining ?? 0)
      : (data?.tracking.installedRemaining ?? 0);

  async function register(): Promise<void> {
    setSaving(true);
    setError('');
    try {
      await registerHoldUnits(props.specification.id, {
        requestKey: crypto.randomUUID(),
        quantity,
        physicalStatus: status,
      });
      setQuantity(1);
      await Promise.all([load(), props.onChanged()]);
    } catch (requestError) {
      setError(toMessage(requestError, '资产编号生成失败'));
    } finally {
      setSaving(false);
    }
  }

  return (
    <section className="hold-unit-manager">
      <header>
        <div>
          <h4>实物与电子标签</h4>
          <p>每颗实物可以生成独立资产编号；总数不会因此重复增加。</p>
        </div>
        {data && <b>{trackingLabel[data.tracking.mode]}</b>}
      </header>
      {loading && !data && <p className="hold-unit-empty">正在读取实物信息…</p>}
      {error && <p className="team-feedback is-error">{error}</p>}
      {data && (
        <>
          <div className="hold-unit-coverage">
            <span>
              <small>总数</small>
              <b>{data.tracking.totalQuantity}</b>
            </span>
            <span>
              <small>已编号</small>
              <b>{data.tracking.registeredQuantity}</b>
            </span>
            <span>
              <small>未编号</small>
              <b>{data.tracking.unregisteredQuantity}</b>
            </span>
            <span>
              <small>已绑标签</small>
              <b>{data.tracking.taggedQuantity}</b>
            </span>
          </div>
          {data.tracking.unregisteredQuantity > 0 && (
            <div className="hold-unit-register">
              <label>
                当前位置
                <select
                  value={status}
                  disabled={props.disabled || saving}
                  onChange={(event) => setStatus(event.target.value as typeof status)}
                >
                  <option value="WAREHOUSE">
                    仓库（未编号 {data.tracking.warehouseRemaining} 颗）
                  </option>
                  <option value="INSTALLED">
                    已上墙（未编号 {data.tracking.installedRemaining} 颗）
                  </option>
                </select>
              </label>
              <label>
                数量
                <input
                  type="number"
                  min={1}
                  max={Math.max(1, remaining)}
                  value={quantity}
                  disabled={props.disabled || saving}
                  onChange={(event) => setQuantity(Number(event.target.value))}
                />
              </label>
              <button
                disabled={
                  props.disabled || saving || remaining < 1 || quantity < 1 || quantity > remaining
                }
                onClick={() => void register()}
              >
                {saving ? '生成中…' : '批量生成资产编号'}
              </button>
            </div>
          )}
          {data.items.length ? (
            <div className="hold-unit-list">
              {data.items.map((unit) => (
                <HoldUnitRow key={unit.id} unit={unit} disabled={props.disabled} onChanged={load} />
              ))}
            </div>
          ) : (
            <p className="hold-unit-empty">
              还没有为实物编号，可从已确认的数量中批量生成资产编号。
            </p>
          )}
          {data.total > data.items.length && (
            <p className="hold-unit-empty">
              当前显示前 {data.items.length} 颗，共 {data.total} 颗。
            </p>
          )}
        </>
      )}
    </section>
  );
}

function HoldUnitRow(props: { unit: HoldUnit; disabled: boolean; onChanged: () => Promise<void> }) {
  const [epc, setEpc] = useState(props.unit.tag?.epc ?? '');
  const [tid, setTid] = useState(props.unit.tag?.tid ?? '');
  const [editing, setEditing] = useState(!props.unit.tag && !props.disabled);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  async function save(): Promise<void> {
    setSaving(true);
    setError('');
    try {
      await bindHoldUnitTag(props.unit.id, {
        requestKey: crypto.randomUUID(),
        epc,
        ...(tid.trim() ? { tid } : {}),
      });
      setEditing(false);
      await props.onChanged();
    } catch (requestError) {
      setError(toMessage(requestError, '标签绑定失败'));
    } finally {
      setSaving(false);
    }
  }

  return (
    <article className="hold-unit-row">
      <div>
        <b>{props.unit.assetCode}</b>
        <small>
          {physicalLabel[props.unit.physicalStatus]} · {props.unit.facility.name}
        </small>
      </div>
      {editing ? (
        <div className="hold-unit-tag-form">
          <input
            aria-label={`${props.unit.assetCode} EPC`}
            placeholder="扫描或输入 EPC"
            value={epc}
            disabled={props.disabled || saving}
            onChange={(event) => setEpc(event.target.value)}
          />
          <input
            aria-label={`${props.unit.assetCode} TID`}
            placeholder="TID（可选，推荐）"
            value={tid}
            disabled={props.disabled || saving}
            onChange={(event) => setTid(event.target.value)}
          />
          <button
            disabled={props.disabled || saving || epc.trim().length < 8}
            onClick={() => void save()}
          >
            {saving ? '绑定中…' : props.unit.tag ? '确认换标' : '绑定标签'}
          </button>
          {props.unit.tag && <button onClick={() => setEditing(false)}>取消</button>}
        </div>
      ) : (
        <div className="hold-unit-tag">
          <span>
            <small>EPC</small>
            <b>{props.unit.tag?.epc ?? '未绑定'}</b>
          </span>
          <button disabled={props.disabled} onClick={() => setEditing(true)}>
            更换标签
          </button>
        </div>
      )}
      {error && <small className="is-error">{error}</small>}
    </article>
  );
}

function toMessage(error: unknown, fallback: string): string {
  return error instanceof Error ? error.message : fallback;
}
