'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  cancelRfidInventorySession,
  completeRfidInventorySession,
  createRfidInventorySession,
  getRfidInventorySession,
  getRfidInventorySessions,
  ingestRfidInventoryReads,
  type RfidInventoryMatchStatus,
  type RfidInventorySessionDetail,
  type RfidInventorySessionListResponse,
} from './hold-api';

const matchLabel: Record<RfidInventoryMatchStatus, string> = {
  MATCHED_EXPECTED: '位置符合',
  MATCHED_UNEXPECTED: '位置异常',
  UNBOUND: '标签未绑定',
  UNKNOWN: '未知标签',
};

export function RfidInventoryPanel() {
  const [data, setData] = useState<RfidInventorySessionListResponse | null>(null);
  const [detail, setDetail] = useState<RfidInventorySessionDetail | null>(null);
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  const load = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      const next = await getRfidInventorySessions();
      setData(next);
      const active = next.items.find((item) => item.status === 'OPEN');
      if (active) setDetail(await getRfidInventorySession(active.id));
    } catch (requestError) {
      setError(toMessage(requestError, 'RFID 盘点加载失败'));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => void load(), [load]);

  const active = data?.items.find((item) => item.status === 'OPEN');
  return (
    <>
      <section className={`rfid-inventory-card ${active ? 'is-active' : ''}`}>
        <span>RFID 工具</span>
        <h3>{active ? active.name : '批量感应盘点'}</h3>
        <p>
          {active
            ? `${active.facility.name} · 已读 ${active.observedQuantity} / 应到 ${active.expectedQuantity}`
            : '批量读取 EPC，区分应到、错位和未知标签。'}
        </p>
        {error && <small className="is-error">{error}</small>}
        <button disabled={loading} onClick={() => setOpen(true)} type="button">
          {active ? '继续盘点' : '开始 RFID 盘点'}
        </button>
      </section>
      {open && (
        <RfidInventoryDialog
          data={data}
          initialDetail={detail}
          onClose={() => setOpen(false)}
          onChanged={async (nextDetail) => {
            setDetail(nextDetail);
            await load();
          }}
        />
      )}
    </>
  );
}

function RfidInventoryDialog(props: {
  data: RfidInventorySessionListResponse | null;
  initialDetail: RfidInventorySessionDetail | null;
  onClose: () => void;
  onChanged: (detail: RfidInventorySessionDetail) => Promise<void>;
}) {
  const [detail, setDetail] = useState(props.initialDetail);
  const [name, setName] = useState(defaultInventoryName());
  const [facilityId, setFacilityId] = useState(
    props.data?.facilities.find((facility) => facility.isDefault)?.id ??
      props.data?.facilities[0]?.id ??
      '',
  );
  const [targetStatus, setTargetStatus] = useState<'WAREHOUSE' | 'INSTALLED'>('WAREHOUSE');
  const [rawEpcs, setRawEpcs] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    const closeOnEscape = (event: KeyboardEvent) => event.key === 'Escape' && props.onClose();
    window.addEventListener('keydown', closeOnEscape);
    return () => window.removeEventListener('keydown', closeOnEscape);
  }, [props]);

  const epcs = useMemo(() => parseEpcs(rawEpcs), [rawEpcs]);

  async function run(action: () => Promise<RfidInventorySessionDetail>): Promise<void> {
    setSaving(true);
    setError('');
    try {
      const next = await action();
      setDetail(next);
      await props.onChanged(next);
    } catch (requestError) {
      setError(toMessage(requestError, '盘点操作失败'));
    } finally {
      setSaving(false);
    }
  }

  async function start(): Promise<void> {
    await run(() =>
      createRfidInventorySession({
        requestKey: crypto.randomUUID(),
        name,
        ...(facilityId ? { facilityId } : {}),
        targetPhysicalStatus: targetStatus,
      }),
    );
  }

  async function submitReads(): Promise<void> {
    if (!detail || !epcs.length) return;
    await run(() => ingestRfidInventoryReads(detail.id, { requestKey: crypto.randomUUID(), epcs }));
    setRawEpcs('');
  }

  async function chooseSession(sessionId: string): Promise<void> {
    setSaving(true);
    setError('');
    try {
      setDetail(await getRfidInventorySession(sessionId));
    } catch (requestError) {
      setError(toMessage(requestError, '盘点明细加载失败'));
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="hold-action-dialog-backdrop" role="presentation" onMouseDown={props.onClose}>
      <section
        aria-label="RFID 批量盘点"
        aria-modal="true"
        className="hold-action-dialog is-wide rfid-inventory-dialog"
        role="dialog"
        onMouseDown={(event) => event.stopPropagation()}
      >
        <header>
          <div>
            <h3>RFID 批量盘点</h3>
            <p>盘点只记录核验结果，不会自动改变库存、所有权或保管方。</p>
          </div>
          <button aria-label="关闭 RFID 盘点" onClick={props.onClose} type="button">
            ×
          </button>
        </header>
        <div className="hold-action-dialog-body rfid-inventory-body">
          {error && <p className="team-feedback is-error">{error}</p>}
          {detail ? (
            <InventoryWorkspace
              detail={detail}
              epcs={epcs}
              rawEpcs={rawEpcs}
              saving={saving}
              onRawEpcs={setRawEpcs}
              onSubmit={submitReads}
              onComplete={() => {
                if (!window.confirm('完成后将保留本次差异快照，不再接收新标签。确定完成？')) return;
                void run(() => completeRfidInventorySession(detail.id, detail.version));
              }}
              onCancel={() => {
                if (!window.confirm('取消后会保留已读数据供审计。确定取消？')) return;
                void run(() => cancelRfidInventorySession(detail.id, detail.version));
              }}
            />
          ) : (
            <StartInventoryForm
              facilities={props.data?.facilities ?? []}
              facilityId={facilityId}
              name={name}
              saving={saving}
              targetStatus={targetStatus}
              onFacility={setFacilityId}
              onName={setName}
              onStart={() => void start()}
              onTarget={setTargetStatus}
            />
          )}
          {!!props.data?.items.length && (
            <section className="rfid-inventory-history">
              <h4>最近盘点</h4>
              <div>
                {props.data.items.slice(0, 8).map((item) => (
                  <button
                    className={detail?.id === item.id ? 'is-active' : ''}
                    disabled={saving}
                    key={item.id}
                    onClick={() => void chooseSession(item.id)}
                    type="button"
                  >
                    <b>{item.name}</b>
                    <small>
                      {sessionStatusLabel(item.status)} · {item.observedQuantity}/
                      {item.expectedQuantity}
                    </small>
                  </button>
                ))}
                {detail?.status !== 'OPEN' && (
                  <button onClick={() => setDetail(null)} type="button">
                    新建盘点
                  </button>
                )}
              </div>
            </section>
          )}
        </div>
      </section>
    </div>
  );
}

function StartInventoryForm(props: {
  facilities: RfidInventorySessionListResponse['facilities'];
  facilityId: string;
  name: string;
  saving: boolean;
  targetStatus: 'WAREHOUSE' | 'INSTALLED';
  onFacility: (value: string) => void;
  onName: (value: string) => void;
  onStart: () => void;
  onTarget: (value: 'WAREHOUSE' | 'INSTALLED') => void;
}) {
  return (
    <section className="rfid-inventory-start">
      <label>
        盘点名称
        <input value={props.name} onChange={(event) => props.onName(event.target.value)} />
      </label>
      <label>
        场馆
        <select value={props.facilityId} onChange={(event) => props.onFacility(event.target.value)}>
          {!props.facilities.length && <option value="">当前岩馆</option>}
          {props.facilities.map((facility) => (
            <option key={facility.id} value={facility.id}>
              {facility.name}
            </option>
          ))}
        </select>
      </label>
      <label>
        目标区域
        <select
          value={props.targetStatus}
          onChange={(event) => props.onTarget(event.target.value as 'WAREHOUSE' | 'INSTALLED')}
        >
          <option value="WAREHOUSE">仓库</option>
          <option value="INSTALLED">已上墙</option>
        </select>
      </label>
      <button
        disabled={props.saving || props.name.trim().length < 2}
        onClick={props.onStart}
        type="button"
      >
        {props.saving ? '创建中…' : '创建盘点快照'}
      </button>
    </section>
  );
}

function InventoryWorkspace(props: {
  detail: RfidInventorySessionDetail;
  epcs: string[];
  rawEpcs: string;
  saving: boolean;
  onRawEpcs: (value: string) => void;
  onSubmit: () => Promise<void>;
  onComplete: () => void;
  onCancel: () => void;
}) {
  const { detail } = props;
  const active = detail.status === 'OPEN';
  const metrics = [
    ['应到', detail.summary.expectedQuantity],
    ['位置符合', detail.summary.matchedExpected],
    ['未读到', detail.summary.missingQuantity],
    ['位置异常', detail.summary.matchedUnexpected],
    ['未绑定', detail.summary.unboundQuantity],
    ['未知', detail.summary.unknownQuantity],
  ];
  return (
    <div className="rfid-inventory-workspace">
      <section className="rfid-inventory-session-heading">
        <div>
          <b>{detail.name}</b>
          <small>
            {detail.facility.name} ·{' '}
            {detail.targetPhysicalStatus === 'WAREHOUSE' ? '仓库' : '已上墙'}
          </small>
        </div>
        <span className={`is-${detail.status.toLowerCase()}`}>
          {sessionStatusLabel(detail.status)}
        </span>
      </section>
      <section className="rfid-inventory-metrics">
        {metrics.map(([label, value]) => (
          <span key={label}>
            <small>{label}</small>
            <b>{value}</b>
          </span>
        ))}
      </section>
      {active && (
        <section className="rfid-read-input">
          <label>
            EPC 读取结果
            <textarea
              placeholder="可粘贴读写器输出；支持换行、空格、逗号或分号分隔"
              value={props.rawEpcs}
              onChange={(event) => props.onRawEpcs(event.target.value)}
            />
          </label>
          <div>
            <small>本批 {props.epcs.length} 条读取；后续硬件适配器直接调用同一接口。</small>
            <button
              disabled={props.saving || !props.epcs.length || props.epcs.length > 500}
              onClick={() => void props.onSubmit()}
              type="button"
            >
              {props.saving ? '上报中…' : '上报这批 EPC'}
            </button>
          </div>
        </section>
      )}
      <ObservationList observations={detail.observations} />
      {active && (
        <footer className="rfid-inventory-actions">
          <button disabled={props.saving} onClick={props.onCancel} type="button">
            取消盘点
          </button>
          <button
            className="is-primary"
            disabled={props.saving || !detail.summary.observedQuantity}
            onClick={props.onComplete}
            type="button"
          >
            确认完成
          </button>
        </footer>
      )}
    </div>
  );
}

function ObservationList({
  observations,
}: {
  observations: RfidInventorySessionDetail['observations'];
}) {
  if (!observations.length) return <p className="detail-empty-state">还没有读取到标签。</p>;
  return (
    <section className="rfid-observation-list">
      <h4>已读标签</h4>
      <div>
        {observations.map((item) => (
          <article key={item.id}>
            <span className={`is-${item.matchStatus.toLowerCase()}`}>
              {matchLabel[item.matchStatus]}
            </span>
            <div>
              <b>{item.unit?.assetCode ?? item.epc}</b>
              <small>
                {item.unit
                  ? `${item.unit.specification.productName} · ${item.unit.facility.name}`
                  : `EPC ${item.epc}`}
              </small>
            </div>
            <small>{item.readCount} 次</small>
          </article>
        ))}
      </div>
    </section>
  );
}

export function parseEpcs(value: string): string[] {
  return value
    .split(/[\s,;，；]+/)
    .map((item) => item.trim())
    .filter(Boolean);
}

function defaultInventoryName(): string {
  return `${new Intl.DateTimeFormat('zh-CN', { month: 'long', day: 'numeric' }).format(new Date())} RFID 盘点`;
}

function sessionStatusLabel(status: 'OPEN' | 'COMPLETED' | 'CANCELLED'): string {
  return status === 'OPEN' ? '进行中' : status === 'COMPLETED' ? '已完成' : '已取消';
}

function toMessage(error: unknown, fallback: string): string {
  return error instanceof Error ? error.message : fallback;
}
