'use client';

import { useCallback, useEffect, useMemo, useState, type ReactNode } from 'react';
import { climbingColorLabel } from '../common/climbing-colors';
import {
  getHoldCategory,
  updateHoldSpecification,
  type HoldCategoryDetail,
  type HoldInitializationBatch,
  type HoldMovement,
  type HoldSpecification,
} from './hold-api';
import { AttachHoldModelDialog } from './attach-hold-model-dialog';
import { HoldInitializationForm } from './hold-initialization-form';
import { HoldAssetGallery } from './hold-model-viewer';
import { bucketLabel, gripLabel, mountingLabel, movementLabel } from './hold-options';
import { HoldSpecificationForm } from './hold-specification-form';
import { HoldStockForm } from './hold-stock-form';
import { HoldUnitManager } from './hold-unit-manager';
import { HoldSpecificationActions } from './hold-variant-actions';
import { ReverseReceiptControl } from './reverse-receipt-control';

type DetailAction = 'EDIT' | 'STOCK' | 'UNITS' | 'HISTORY' | 'INITIALIZATION' | 'MORE';

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
      setError(toMessage(requestError, '岩点档案加载失败'));
    } finally {
      setLoading(false);
    }
  }, [props.categoryId]);

  useEffect(() => void load(), [load]);

  const specification = useMemo(
    () =>
      category?.specifications.find((item) => item.id === props.initialSpecificationId) ??
      category?.specifications[0] ??
      null,
    [category, props.initialSpecificationId],
  );

  async function refreshAll(): Promise<void> {
    await Promise.all([load(), props.onChanged()]);
  }

  return (
    <div className="hold-detail-backdrop" role="presentation" onMouseDown={props.onClose}>
      <aside
        className="hold-detail-panel hold-specification-detail"
        role="dialog"
        aria-modal="true"
        aria-label={specification ? `${specification.productName}档案` : '岩点档案'}
        onMouseDown={(event) => event.stopPropagation()}
      >
        <DetailHeader category={category} specification={specification} onClose={props.onClose} />
        <div className="hold-detail-body">
          {loading && !category && <p className="detail-empty-state">正在读取岩点档案…</p>}
          {error && <p className="team-feedback is-error">{error}</p>}
          {category && specification && (
            <SpecificationDetail
              category={category}
              specification={specification}
              canAdjust={props.canAdjust}
              initializationBatch={props.initializationBatch}
              onChanged={refreshAll}
              onDeleted={async () => {
                props.onClose();
                await props.onChanged();
              }}
            />
          )}
          {category && !specification && (
            <p className="detail-empty-state">这个岩点档案不存在或已被删除。</p>
          )}
        </div>
      </aside>
    </div>
  );
}

function DetailHeader(props: {
  category: HoldCategoryDetail | null;
  specification: HoldSpecification | null;
  onClose: () => void;
}) {
  const { category, specification } = props;
  return (
    <header className="hold-detail-header">
      <div>
        <span className="hold-detail-kicker">岩点档案</span>
        <h2 className="hold-detail-title">
          <strong>{specification?.productName ?? '加载中'}</strong>
          {category && specification && (
            <small>
              {gripLabel[category.gripType]} · {specification.sizeClass}
            </small>
          )}
        </h2>
        {category && specification && (
          <p>
            {specification.manufacturer || '品牌未填'} · {climbingColorLabel(specification.color)} ·{' '}
            {category.name}
            {specification.status === 'ARCHIVED' ? ' · 已停用' : ''}
          </p>
        )}
      </div>
      <button aria-label="关闭岩点档案" onClick={props.onClose}>
        ×
      </button>
    </header>
  );
}

function SpecificationDetail(props: {
  category: HoldCategoryDetail;
  specification: HoldSpecification;
  canAdjust: boolean;
  initializationBatch: HoldInitializationBatch | null;
  onChanged: () => Promise<void>;
  onDeleted: () => Promise<void>;
}) {
  const [action, setAction] = useState<DetailAction | null>(null);
  const [attachOpen, setAttachOpen] = useState(false);
  const active = props.category.status === 'ACTIVE' && props.specification.status === 'ACTIVE';
  const hasModel = props.specification.assets.some(
    (asset) => asset.kind === 'MODEL_3D' && asset.status === 'READY',
  );
  const closeAfterChange = async () => {
    await props.onChanged();
    setAction(null);
  };

  return (
    <>
      <section className="hold-detail-overview">
        <div className="hold-detail-model">
          {hasModel ? (
            <HoldAssetGallery assets={props.specification.assets} />
          ) : (
            <button
              className="hold-detail-model-empty"
              disabled={!active}
              onClick={() => setAttachOpen(true)}
              type="button"
            >
              <b>暂无 3D 模型</b>
              <span>{active ? '点击添加模型' : '档案已停用'}</span>
            </button>
          )}
        </div>
        <OverviewFacts category={props.category} specification={props.specification} />
      </section>

      <InventorySummary specification={props.specification} />

      <section className="hold-detail-actions" aria-label="岩点档案操作">
        <ActionButton
          title="编辑档案"
          detail="名称、品牌、尺寸"
          onClick={() => setAction('EDIT')}
        />
        <ActionButton
          title="新增或修改数量"
          detail="仓库、上墙、维护"
          disabled={!active}
          onClick={() => setAction('STOCK')}
        />
        <ActionButton
          title="实物与电子标签"
          detail="资产编号、RFID"
          onClick={() => setAction('UNITS')}
        />
        <ActionButton title="变动记录" detail="查看数量变化" onClick={() => setAction('HISTORY')} />
        {props.initializationBatch && (
          <ActionButton
            title="记录本次盘点"
            detail={props.initializationBatch.name}
            disabled={!active}
            onClick={() => setAction('INITIALIZATION')}
          />
        )}
        {props.canAdjust && (
          <ActionButton title="更多操作" detail="停用或删除" onClick={() => setAction('MORE')} />
        )}
      </section>

      {action === 'EDIT' && (
        <HoldActionDialog title="编辑岩点档案" onClose={() => setAction(null)}>
          <HoldSpecificationForm
            initial={props.specification}
            submitLabel="保存档案"
            onCancel={() => setAction(null)}
            onSubmit={async (input) => {
              await updateHoldSpecification(props.specification.id, input);
              await closeAfterChange();
            }}
          />
        </HoldActionDialog>
      )}
      {action === 'STOCK' && (
        <HoldActionDialog
          title="新增或修改数量"
          detail="选择新增到仓库，或按现场盘点结果修改当前位置的数量。"
          onClose={() => setAction(null)}
        >
          <HoldStockForm
            specification={props.specification}
            canAdjust={props.canAdjust}
            onChanged={closeAfterChange}
          />
        </HoldActionDialog>
      )}
      {action === 'UNITS' && (
        <HoldActionDialog
          wide
          title="实物与电子标签"
          detail="为每颗实物生成资产编号，并绑定电子标签。"
          onClose={() => setAction(null)}
        >
          <HoldUnitManager
            specification={props.specification}
            disabled={!active}
            onChanged={props.onChanged}
          />
        </HoldActionDialog>
      )}
      {action === 'HISTORY' && (
        <HoldActionDialog
          wide
          title="变动记录"
          detail="这个岩点的数量变化都会保留。"
          onClose={() => setAction(null)}
        >
          <MovementTimeline
            movements={relatedMovements(props.category.movements, props.specification)}
            canReverse={props.canAdjust && active}
            onChanged={props.onChanged}
          />
        </HoldActionDialog>
      )}
      {action === 'INITIALIZATION' && props.initializationBatch && (
        <HoldActionDialog title="记录本次盘点" onClose={() => setAction(null)}>
          <HoldInitializationForm
            batch={props.initializationBatch}
            specification={props.specification}
            onChanged={closeAfterChange}
          />
        </HoldActionDialog>
      )}
      {action === 'MORE' && (
        <HoldActionDialog title="更多操作" onClose={() => setAction(null)}>
          <HoldSpecificationActions
            specification={props.specification}
            categoryActive={props.category.status === 'ACTIVE'}
            onChanged={closeAfterChange}
            onDeleted={props.onDeleted}
          />
        </HoldActionDialog>
      )}
      {attachOpen && (
        <AttachHoldModelDialog
          specification={props.specification}
          onClose={() => setAttachOpen(false)}
          onCompleted={async () => {
            setAttachOpen(false);
            await props.onChanged();
          }}
        />
      )}
    </>
  );
}

function OverviewFacts(props: { category: HoldCategoryDetail; specification: HoldSpecification }) {
  const specification = props.specification;
  return (
    <dl className="hold-detail-facts">
      <div>
        <dt>品牌</dt>
        <dd>{specification.manufacturer || '未填写'}</dd>
      </div>
      <div>
        <dt>类型 / 尺寸</dt>
        <dd>
          {gripLabel[props.category.gripType]} · {specification.sizeClass}
        </dd>
      </div>
      <div>
        <dt>固定方式</dt>
        <dd>{mountingLabel[specification.mountingType]}</dd>
      </div>
      <div>
        <dt>货号</dt>
        <dd>{specification.sku || '未填写'}</dd>
      </div>
    </dl>
  );
}

function InventorySummary({ specification }: { specification: HoldSpecification }) {
  const inventory = specification.inventory;
  const items = [
    ['总数', inventory.totalQuantity],
    ['仓库', inventory.warehouseQuantity],
    ['已上墙', inventory.installedQuantity],
    ['维护', inventory.maintenanceQuantity],
  ];
  return (
    <section className="hold-detail-counts">
      {items.map(([label, value]) => (
        <span key={label}>
          <small>{label}</small>
          <b>{value} 颗</b>
        </span>
      ))}
    </section>
  );
}

function ActionButton(props: {
  title: string;
  detail: string;
  disabled?: boolean;
  onClick: () => void;
}) {
  return (
    <button disabled={props.disabled} onClick={props.onClick} type="button">
      <b>{props.title}</b>
      <span>{props.detail}</span>
      <i>›</i>
    </button>
  );
}

function HoldActionDialog(props: {
  title: string;
  detail?: string;
  wide?: boolean;
  onClose: () => void;
  children: ReactNode;
}) {
  useEffect(() => {
    const closeOnEscape = (event: KeyboardEvent) => event.key === 'Escape' && props.onClose();
    window.addEventListener('keydown', closeOnEscape);
    return () => window.removeEventListener('keydown', closeOnEscape);
  }, [props]);
  return (
    <div className="hold-action-dialog-backdrop" role="presentation" onMouseDown={props.onClose}>
      <section
        aria-modal="true"
        className={`hold-action-dialog ${props.wide ? 'is-wide' : ''}`}
        role="dialog"
        aria-label={props.title}
        onMouseDown={(event) => event.stopPropagation()}
      >
        <header>
          <div>
            <h3>{props.title}</h3>
            {props.detail && <p>{props.detail}</p>}
          </div>
          <button aria-label={`关闭${props.title}`} onClick={props.onClose}>
            ×
          </button>
        </header>
        <div className="hold-action-dialog-body">{props.children}</div>
      </section>
    </div>
  );
}

function MovementTimeline(props: {
  movements: HoldMovement[];
  canReverse: boolean;
  onChanged: () => Promise<void>;
}) {
  if (!props.movements.length) return <p className="detail-empty-state">暂无变动记录</p>;
  return (
    <ol className="hold-movement-list is-compact">
      {props.movements.map((movement) => (
        <li key={movement.id} className={movement.reversed ? 'is-reversed' : ''}>
          <div>
            <b>
              {movementLabel[movement.type] ?? movement.type}
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
  );
}

function relatedMovements(
  movements: HoldMovement[],
  specification: HoldSpecification,
): HoldMovement[] {
  return movements.filter(
    (movement) =>
      movement.specification.productName === specification.productName &&
      movement.specification.color === specification.color,
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
