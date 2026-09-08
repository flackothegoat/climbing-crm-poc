'use client';

import { FormEvent, useEffect, useState } from 'react';
import { CameraObservationDetail } from './camera-observation-detail';
import { CameraObservationTable } from './camera-observation-table';
import {
  getCameraObservation,
  getCameraObservations,
  type CameraObservation,
  type CameraObservationFilters,
} from './camera-live-api';
import styles from './camera-observation-panel.module.css';

interface FilterDraft {
  query: string;
  outcome: string;
  reviewStatus: string;
  observedFrom: string;
  observedTo: string;
}

const emptyFilters: FilterDraft = {
  query: '',
  outcome: '',
  reviewStatus: '',
  observedFrom: '',
  observedTo: '',
};

export function CameraObservationPanel() {
  const [expanded, setExpanded] = useState(false);
  const [items, setItems] = useState<CameraObservation[]>([]);
  const [nextCursor, setNextCursor] = useState<string | null>(null);
  const [filters, setFilters] = useState<FilterDraft>(emptyFilters);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [selected, setSelected] = useState<CameraObservation | null>(null);

  useEffect(() => {
    void loadObservations({ pageSize: 10 });
  }, []);

  async function loadObservations(query: CameraObservationFilters, append = false) {
    setLoading(true);
    setError('');
    try {
      const result = await getCameraObservations(query);
      setItems((current) => (append ? [...current, ...result.items] : result.items));
      setNextCursor(result.nextCursor);
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : '识别结果加载失败');
    } finally {
      setLoading(false);
    }
  }

  function openHistory() {
    setExpanded(true);
    void loadObservations(toQuery(filters));
  }

  function submitFilters(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setExpanded(true);
    void loadObservations(toQuery(filters));
  }

  function resetFilters() {
    setFilters(emptyFilters);
    void loadObservations({ pageSize: expanded ? 20 : 10 });
  }

  async function openDetail(observationId: string) {
    setError('');
    try {
      setSelected(await getCameraObservation(observationId));
    } catch (detailError) {
      setError(detailError instanceof Error ? detailError.message : '识别详情加载失败');
    }
  }

  function updateObservation(updated: CameraObservation) {
    setSelected(updated);
    setItems((current) => current.map((item) => (item.id === updated.id ? updated : item)));
  }

  return (
    <section className={styles.panel}>
      <header className={styles.header}>
        <div>
          <small>VISION EVENTS</small>
          <h3>识别结果</h3>
        </div>
        <div className={styles.headerActions}>
          <p>保留算法原始判定，并通过人工复核形成最终结论。</p>
          <button
            type="button"
            onClick={expanded ? () => void loadObservations(toQuery(filters)) : openHistory}
          >
            {expanded ? '刷新' : '查看全部'}
          </button>
        </div>
      </header>

      <ObservationFilters
        value={filters}
        onChange={setFilters}
        onReset={resetFilters}
        onSubmit={submitFilters}
      />
      {error ? <p className={styles.error}>{error}</p> : null}
      <CameraObservationTable items={items} loading={loading} onSelect={openDetail} />
      {expanded && nextCursor ? (
        <div className={styles.loadMore}>
          <button
            type="button"
            disabled={loading}
            onClick={() => void loadObservations({ ...toQuery(filters), cursor: nextCursor }, true)}
          >
            {loading ? '加载中…' : '加载更多'}
          </button>
        </div>
      ) : null}
      {!expanded ? <p className={styles.limitHint}>只显示最近10条</p> : null}
      {selected ? (
        <CameraObservationDetail
          observation={selected}
          onClose={() => setSelected(null)}
          onReviewed={updateObservation}
        />
      ) : null}
    </section>
  );
}

function ObservationFilters({
  value,
  onChange,
  onReset,
  onSubmit,
}: {
  value: FilterDraft;
  onChange: (value: FilterDraft) => void;
  onReset: () => void;
  onSubmit: (event: FormEvent<HTMLFormElement>) => void;
}) {
  return (
    <form className={styles.filters} onSubmit={onSubmit}>
      <label>
        线路
        <input
          value={value.query}
          placeholder="线路编号或名称"
          onChange={(event) => onChange({ ...value, query: event.target.value })}
        />
      </label>
      <label>
        算法结果
        <select
          value={value.outcome}
          onChange={(event) => onChange({ ...value, outcome: event.target.value })}
        >
          <option value="">全部</option>
          <option value="COMPLETED">完攀</option>
          <option value="FAILED">失败</option>
          <option value="ABANDONED">放弃</option>
          <option value="UNKNOWN">不确定</option>
        </select>
      </label>
      <label>
        复核状态
        <select
          value={value.reviewStatus}
          onChange={(event) => onChange({ ...value, reviewStatus: event.target.value })}
        >
          <option value="">全部</option>
          <option value="PENDING">待复核</option>
          <option value="UNREVIEWED">全部未复核</option>
          <option value="CONFIRMED">已确认</option>
          <option value="OVERRIDDEN">已改判</option>
          <option value="INVALIDATED">无效片段</option>
        </select>
      </label>
      <DateFilter
        label="开始日期"
        value={value.observedFrom}
        onChange={(observedFrom) => onChange({ ...value, observedFrom })}
      />
      <DateFilter
        label="结束日期"
        value={value.observedTo}
        onChange={(observedTo) => onChange({ ...value, observedTo })}
      />
      <div className={styles.filterActions}>
        <button type="submit">查找</button>
        <button type="button" onClick={onReset}>
          重置
        </button>
      </div>
    </form>
  );
}

function DateFilter({
  label,
  value,
  onChange,
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
}) {
  return (
    <label>
      {label}
      <input type="date" value={value} onChange={(event) => onChange(event.target.value)} />
    </label>
  );
}

function toQuery(filters: FilterDraft): CameraObservationFilters {
  return {
    pageSize: 20,
    query: filters.query || undefined,
    outcome: (filters.outcome || undefined) as CameraObservation['outcome'] | undefined,
    reviewStatus: (filters.reviewStatus || undefined) as CameraObservationFilters['reviewStatus'],
    observedFrom: filters.observedFrom
      ? new Date(`${filters.observedFrom}T00:00:00`).toISOString()
      : undefined,
    observedTo: filters.observedTo
      ? new Date(`${filters.observedTo}T23:59:59.999`).toISOString()
      : undefined,
  };
}
