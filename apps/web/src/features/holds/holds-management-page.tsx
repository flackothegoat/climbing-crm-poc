'use client';

import type { FormEvent } from 'react';
import { useState } from 'react';
import type { AuthenticatedSession } from '../../lib/server-session';
import { DashboardIcon } from '../dashboard/dashboard-icons';
import { PageHeading, StatGrid } from '../dashboard/page-components';
import { CreateHoldRecordDialog } from './create-hold-record-dialog';
import { HoldDetailPanel } from './hold-detail-panel';
import { HoldInitializationPanel } from './hold-initialization-panel';
import { HoldTable } from './hold-table';
import { formatGripLabel, gripOptions } from './hold-options';
import { useHoldsData } from './use-holds-data';
import { useHoldInitialization } from './use-hold-initialization';

export function HoldsManagementPage({ session }: { session: AuthenticatedSession }) {
  const [searchDraft, setSearchDraft] = useState('');
  const [search, setSearch] = useState('');
  const [gripType, setGripType] = useState('');
  const [showStopped, setShowStopped] = useState(false);
  const [createOpen, setCreateOpen] = useState(false);
  const [createCategoryId, setCreateCategoryId] = useState('');
  const [selectedCategoryId, setSelectedCategoryId] = useState('');
  const [selectedSpecificationId, setSelectedSpecificationId] = useState('');
  const data = useHoldsData(search, gripType, showStopped);
  const initialization = useHoldInitialization();

  async function refreshAll(): Promise<void> {
    await Promise.all([data.refresh(), initialization.refresh()]);
  }

  function submitSearch(event: FormEvent): void {
    event.preventDefault();
    setSearch(searchDraft.trim());
  }

  function openCreateRecord(categoryId = ''): void {
    setSelectedCategoryId('');
    setSelectedSpecificationId('');
    setCreateCategoryId(categoryId);
    setCreateOpen(true);
  }

  return (
    <div className="page-stack">
      <PageHeading
        eyebrow="岩点管理"
        title="岩点库"
        description="同款岩点只建一份档案，通过数量管理仓库、上墙和维护状态。"
        aside={
          <button className="page-action page-action-active" onClick={() => openCreateRecord()}>
            <DashboardIcon name="holds" />
            新增岩点档案
          </button>
        }
      />
      <HoldInitializationPanel
        batch={initialization.batch}
        loading={initialization.loading}
        onCancel={initialization.cancel}
        onComplete={initialization.complete}
        onAddRecord={() => openCreateRecord()}
        onStart={initialization.start}
      />
      {initialization.error && (
        <RequestFailure message={initialization.error} onRetry={initialization.refresh} />
      )}
      <StatGrid items={buildStats(data.summary)} />
      <HoldFilters
        gripType={gripType}
        searchDraft={searchDraft}
        showStopped={showStopped}
        onGripType={setGripType}
        onSearchDraft={setSearchDraft}
        onShowStopped={setShowStopped}
        onSubmit={submitSearch}
      />
      {data.error && <RequestFailure message={data.error} onRetry={data.refresh} />}
      <HoldTable
        categories={data.categories}
        loading={data.loading}
        onSelect={(category, specification) => {
          setSelectedCategoryId(category.id);
          setSelectedSpecificationId(specification.id);
        }}
      />
      {createOpen && (
        <CreateHoldRecordDialog
          batch={initialization.batch}
          initialCategoryId={createCategoryId || undefined}
          onClose={() => setCreateOpen(false)}
          onCompleted={refreshAll}
        />
      )}
      {selectedCategoryId && (
        <HoldDetailPanel
          canAdjust={session.role === 'L1_ADMIN'}
          categoryId={selectedCategoryId}
          initialSpecificationId={selectedSpecificationId}
          initializationBatch={initialization.batch}
          onChanged={refreshAll}
          onClose={() => {
            setSelectedCategoryId('');
            setSelectedSpecificationId('');
          }}
          onCreateRecord={openCreateRecord}
        />
      )}
    </div>
  );
}

function RequestFailure(props: { message: string; onRetry: () => Promise<void> }) {
  return (
    <div className="team-feedback is-error hold-request-failure" role="alert">
      <span>{props.message}</span>
      <button onClick={() => void props.onRetry()} type="button">
        重新加载
      </button>
    </div>
  );
}

function HoldFilters(props: {
  searchDraft: string;
  gripType: string;
  showStopped: boolean;
  onSearchDraft: (value: string) => void;
  onGripType: (value: string) => void;
  onShowStopped: (value: boolean) => void;
  onSubmit: (event: FormEvent) => void;
}) {
  return (
    <form className="hold-filters" onSubmit={props.onSubmit}>
      <input
        aria-label="搜索岩点"
        placeholder="搜索用途、造型或生产商"
        value={props.searchDraft}
        onChange={(event) => props.onSearchDraft(event.target.value)}
      />
      <select
        aria-label="抓握类型"
        value={props.gripType}
        onChange={(event) => props.onGripType(event.target.value)}
      >
        <option value="">全部类型</option>
        {gripOptions.map(([value]) => (
          <option key={value} value={value}>
            {formatGripLabel(value)}
          </option>
        ))}
      </select>
      <label className="hold-archive-toggle">
        <input
          type="checkbox"
          checked={props.showStopped}
          onChange={(event) => props.onShowStopped(event.target.checked)}
        />
        显示已停用
      </label>
      <button type="submit">查询</button>
    </form>
  );
}

function buildStats(summary: ReturnType<typeof useHoldsData>['summary']) {
  return [
    {
      label: '用途分类',
      value: String(summary.categoryCount),
      detail: `${summary.specificationCount} 个岩点档案`,
      tone: 'accent' as const,
    },
    { label: '仓库可用', value: String(summary.warehouseQuantity), detail: '件' },
    { label: '已上墙', value: String(summary.installedQuantity), detail: '件正在使用' },
    {
      label: '待核验',
      value: String(summary.unverifiedCount),
      detail: '组库存待确认',
      tone: 'warning' as const,
    },
  ];
}
