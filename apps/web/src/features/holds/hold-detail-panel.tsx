'use client';

import { useCallback, useEffect, useState, type ReactNode } from 'react';
import { climbingColorCss, climbingColorLabel } from '../common/climbing-colors';
import { getHoldCategory, type HoldCategoryDetail, type HoldInitializationBatch } from './hold-api';
import { HoldCategoryLifecycleActions } from './hold-lifecycle-actions';
import { HoldCategoryMetadataEditor } from './hold-metadata-editor';
import { bucketLabel, gripEnglishLabel, movementLabel } from './hold-options';
import { HoldSpecificationBrowser } from './hold-specification-browser';
import { ReverseReceiptControl } from './reverse-receipt-control';

interface DetailPanelProps {
  categoryId: string;
  initialSpecificationId?: string;
  canAdjust: boolean;
  initializationBatch: HoldInitializationBatch | null;
  onChanged: () => Promise<void>;
  onClose: () => void;
  onCreateRecord: (categoryId: string) => void;
}

export function HoldDetailPanel(props: DetailPanelProps) {
  const [category, setCategory] = useState<HoldCategoryDetail | null>(null);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      setCategory(await getHoldCategory(props.categoryId));
    } catch (requestError) {
      setError(toMessage(requestError, '用途分类加载失败'));
    } finally {
      setLoading(false);
    }
  }, [props.categoryId]);

  useEffect(() => void load(), [load]);

  async function refreshAll(): Promise<void> {
    await Promise.all([load(), props.onChanged()]);
  }

  return (
    <div className="hold-detail-backdrop" role="presentation" onMouseDown={props.onClose}>
      <aside
        className="hold-detail-panel"
        role="dialog"
        aria-modal="true"
        onMouseDown={(event) => event.stopPropagation()}
      >
        <DetailHeader category={category} onClose={props.onClose} />
        <div className="hold-detail-body">
          {loading && !category && <p className="detail-empty-state">正在读取用途分类…</p>}
          {error && <p className="team-feedback is-error">{error}</p>}
          {category && (
            <DetailContent
              category={category}
              canAdjust={props.canAdjust}
              initialSpecificationId={props.initialSpecificationId}
              initializationBatch={props.initializationBatch}
              onCreateRecord={props.onCreateRecord}
              onChanged={refreshAll}
              onDeleted={async () => {
                props.onClose();
                await props.onChanged();
              }}
            />
          )}
        </div>
      </aside>
    </div>
  );
}

function DetailHeader(props: { category: HoldCategoryDetail | null; onClose: () => void }) {
  const category = props.category;
  const englishName = category ? gripEnglishLabel[category.gripType].toLowerCase() : '';
  return (
    <header className="hold-detail-header">
      <div>
        <span className="hold-detail-kicker">用途分类</span>
        <h2 className="hold-detail-title">
          <strong>{category?.name ?? '加载中'}</strong>
          {category && <small>{englishName}</small>}
        </h2>
        {category && (
          <p>
            {category.source === 'DEFAULT' ? '默认分类' : category.code}
            {category.status === 'ARCHIVED' ? ' · 已停用' : ''}
          </p>
        )}
      </div>
      <button aria-label="关闭分类详情" onClick={props.onClose}>
        ×
      </button>
    </header>
  );
}

function DetailContent(props: {
  category: HoldCategoryDetail;
  canAdjust: boolean;
  initialSpecificationId?: string;
  initializationBatch: HoldInitializationBatch | null;
  onChanged: () => Promise<void>;
  onDeleted: () => Promise<void>;
  onCreateRecord: (categoryId: string) => void;
}) {
  const active = props.category.status === 'ACTIVE';
  return (
    <>
      <HoldCategoryMetadataEditor
        category={props.category}
        disabled={!active}
        onChanged={props.onChanged}
      />
      <SpecificationSection
        category={props.category}
        canAdjust={props.canAdjust}
        initialSpecificationId={props.initialSpecificationId}
        initializationBatch={props.initializationBatch}
        onCreateRecord={props.onCreateRecord}
        onChanged={props.onChanged}
      />
      <MovementTimeline
        category={props.category}
        canReverse={props.canAdjust && active}
        onChanged={props.onChanged}
      />
      {props.canAdjust && (
        <HoldCategoryLifecycleActions
          category={props.category}
          onChanged={props.onChanged}
          onDeleted={props.onDeleted}
        />
      )}
    </>
  );
}

function SpecificationSection(props: {
  category: HoldCategoryDetail;
  canAdjust: boolean;
  initialSpecificationId?: string;
  initializationBatch: HoldInitializationBatch | null;
  onChanged: () => Promise<void>;
  onCreateRecord: (categoryId: string) => void;
}) {
  const active = props.category.status === 'ACTIVE';
  return (
    <section className="hold-detail-section">
      <SectionTitle
        title="岩点档案"
        detail="按名称、颜色、尺寸或品牌快速找到岩点"
        action={
          <button disabled={!active} onClick={() => props.onCreateRecord(props.category.id)}>
            新增岩点档案
          </button>
        }
      />
      {!props.category.specifications.length && (
        <p className="detail-empty-state">这里还没有岩点，先添加一个吧。</p>
      )}
      {props.category.specifications.length > 0 && (
        <HoldSpecificationBrowser
          specifications={props.category.specifications}
          categoryActive={active}
          canAdjust={props.canAdjust}
          initialExpandedId={props.initialSpecificationId}
          initializationBatch={props.initializationBatch}
          onChanged={props.onChanged}
        />
      )}
    </section>
  );
}

function MovementTimeline(props: {
  category: HoldCategoryDetail;
  canReverse: boolean;
  onChanged: () => Promise<void>;
}) {
  return (
    <section className="hold-detail-section">
      <SectionTitle title="库存记录" detail="每次库存变化都在这里，填错的入库可以撤销" />
      {props.category.movements.length ? (
        <ol className="hold-movement-list">
          {props.category.movements.map((movement) => (
            <li key={movement.id} className={movement.reversed ? 'is-reversed' : ''}>
              <i style={{ background: climbingColorCss(movement.specification.color) }} />
              <div>
                <b>
                  {movementLabel[movement.type] ?? movement.type} ·{' '}
                  {movement.specification.productName} /{' '}
                  {climbingColorLabel(movement.specification.color)}
                  {movement.reversed && <em>已撤销</em>}
                </b>
                <span>
                  {movement.actorName} · {formatDate(movement.occurredAt)}
                </span>
                {movement.note && <small>{movement.note}</small>}
                {props.canReverse && movement.canReverse && (
                  <ReverseReceiptControl movement={movement} onChanged={props.onChanged} />
                )}
              </div>
              <strong className={movement.quantityDelta > 0 ? 'is-positive' : 'is-negative'}>
                {movement.quantityDelta > 0 ? '+' : ''}
                {movement.quantityDelta}
                <small>{bucketLabel[movement.bucket]}</small>
              </strong>
            </li>
          ))}
        </ol>
      ) : (
        <p className="detail-empty-state">暂无库存流水</p>
      )}
    </section>
  );
}

function SectionTitle(props: { title: string; detail: string; action?: ReactNode }) {
  return (
    <header className="hold-section-title">
      <div>
        <h3>{props.title}</h3>
        <p>{props.detail}</p>
      </div>
      {props.action}
    </header>
  );
}

function formatDate(value: string): string {
  return new Intl.DateTimeFormat('zh-CN', {
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  }).format(new Date(value));
}

const toMessage = (error: unknown, fallback: string) =>
  error instanceof Error ? error.message : fallback;
