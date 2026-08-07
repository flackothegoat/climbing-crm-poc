'use client';

import { useMemo, useState } from 'react';
import type { HoldInitializationBatch, HoldSpecification } from './hold-api';
import { AttachHoldModelDialog } from './attach-hold-model-dialog';
import { HoldInitializationForm } from './hold-initialization-form';
import { HoldAssetGallery } from './hold-model-viewer';
import { mountingLabel } from './hold-options';
import { HoldStockForm } from './hold-stock-form';
import { HoldSpecificationActions } from './hold-variant-actions';
import { HoldSpecificationEditor } from './hold-variant-editor';

type ModelFilter = 'ALL' | 'WITH_MODEL' | 'WITHOUT_MODEL';
type StatusFilter = 'ALL' | 'ACTIVE' | 'ARCHIVED';

export interface SpecificationFilters {
  query: string;
  color: string;
  size: string;
  manufacturer: string;
  model: ModelFilter;
  status: StatusFilter;
}

export const emptySpecificationFilters: SpecificationFilters = {
  query: '',
  color: '',
  size: '',
  manufacturer: '',
  model: 'ALL',
  status: 'ALL',
};

interface BrowserProps {
  specifications: HoldSpecification[];
  categoryActive: boolean;
  canAdjust: boolean;
  initializationBatch: HoldInitializationBatch | null;
  onChanged: () => Promise<void>;
}

export function HoldSpecificationBrowser(props: BrowserProps) {
  const [filters, setFilters] = useState(emptySpecificationFilters);
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const visibleItems = useMemo(
    () => filterHoldSpecifications(props.specifications, filters),
    [filters, props.specifications],
  );
  const options = useMemo(() => buildFilterOptions(props.specifications), [props.specifications]);

  return (
    <>
      <SpecificationFilterBar
        filters={filters}
        options={options}
        resultCount={visibleItems.length}
        totalCount={props.specifications.length}
        onChange={setFilters}
      />
      {!visibleItems.length ? (
        <p className="detail-empty-state">没有找到符合条件的岩点。</p>
      ) : (
        <div className="hold-variant-list">
          {visibleItems.map((specification) => (
            <SpecificationCard
              key={specification.id}
              specification={specification}
              expanded={expandedId === specification.id}
              categoryActive={props.categoryActive}
              canAdjust={props.canAdjust}
              initializationBatch={props.initializationBatch}
              onToggle={() =>
                setExpandedId((current) => (current === specification.id ? null : specification.id))
              }
              onChanged={props.onChanged}
            />
          ))}
        </div>
      )}
    </>
  );
}

function SpecificationFilterBar(props: {
  filters: SpecificationFilters;
  options: ReturnType<typeof buildFilterOptions>;
  resultCount: number;
  totalCount: number;
  onChange: (filters: SpecificationFilters) => void;
}) {
  const update = (field: keyof SpecificationFilters, value: string) =>
    props.onChange({ ...props.filters, [field]: value });
  return (
    <div className="hold-specification-browser">
      <input
        aria-label="搜索岩点档案"
        placeholder="搜索名称、颜色、品牌或货号"
        value={props.filters.query}
        onChange={(event) => update('query', event.target.value)}
      />
      <FilterSelect
        label="全部颜色"
        value={props.filters.color}
        options={props.options.colors}
        onChange={(value) => update('color', value)}
      />
      <FilterSelect
        label="全部尺寸"
        value={props.filters.size}
        options={props.options.sizes}
        onChange={(value) => update('size', value)}
      />
      <FilterSelect
        label="全部品牌"
        value={props.filters.manufacturer}
        options={props.options.manufacturers}
        onChange={(value) => update('manufacturer', value)}
      />
      <select
        aria-label="3D 模型"
        value={props.filters.model}
        onChange={(event) => update('model', event.target.value)}
      >
        <option value="ALL">全部模型</option>
        <option value="WITH_MODEL">有 3D 模型</option>
        <option value="WITHOUT_MODEL">待补 3D 模型</option>
      </select>
      <select
        aria-label="档案状态"
        value={props.filters.status}
        onChange={(event) => update('status', event.target.value)}
      >
        <option value="ALL">全部状态</option>
        <option value="ACTIVE">使用中</option>
        <option value="ARCHIVED">已停用</option>
      </select>
      <div className="hold-filter-summary">
        <span>
          显示 {props.resultCount} / {props.totalCount} 个
        </span>
        {hasFilters(props.filters) && (
          <button onClick={() => props.onChange(emptySpecificationFilters)}>清空筛选</button>
        )}
      </div>
    </div>
  );
}

function FilterSelect(props: {
  label: string;
  value: string;
  options: string[];
  onChange: (value: string) => void;
}) {
  return (
    <select
      aria-label={props.label}
      value={props.value}
      onChange={(event) => props.onChange(event.target.value)}
    >
      <option value="">{props.label}</option>
      {props.options.map((option) => (
        <option key={option}>{option}</option>
      ))}
    </select>
  );
}

function SpecificationCard(props: {
  specification: HoldSpecification;
  expanded: boolean;
  categoryActive: boolean;
  canAdjust: boolean;
  initializationBatch: HoldInitializationBatch | null;
  onToggle: () => void;
  onChanged: () => Promise<void>;
}) {
  const [attachOpen, setAttachOpen] = useState(false);
  const item = props.specification;
  const active = props.categoryActive && item.status === 'ACTIVE';
  return (
    <article
      className={`hold-variant-card ${active ? '' : 'is-stopped'} ${props.expanded ? 'is-expanded' : ''}`}
    >
      <SpecificationHeader specification={item} />
      <HoldAssetGallery assets={item.assets} />
      {!hasModelAsset(item) && (
        <ModelPlaceholder active={active} onAdd={() => setAttachOpen(true)} />
      )}
      <SpecificationMetadata specification={item} />
      <InventoryGrid specification={item} />
      <button className="hold-card-toggle" onClick={props.onToggle}>
        {props.expanded ? '收起' : '管理档案'}
      </button>
      {props.expanded && <SpecificationOperations {...props} active={active} />}
      {attachOpen && (
        <AttachHoldModelDialog
          specification={item}
          onClose={() => setAttachOpen(false)}
          onCompleted={props.onChanged}
        />
      )}
    </article>
  );
}

function SpecificationOperations(
  props: Parameters<typeof SpecificationCard>[0] & { active: boolean },
) {
  const item = props.specification;
  return (
    <div className="hold-variant-operations">
      {props.active && <HoldSpecificationEditor specification={item} onChanged={props.onChanged} />}
      {props.active && props.initializationBatch && (
        <HoldInitializationForm
          batch={props.initializationBatch}
          specification={item}
          onChanged={props.onChanged}
        />
      )}
      {props.active ? (
        <HoldStockForm
          specification={item}
          canAdjust={props.canAdjust}
          onChanged={props.onChanged}
        />
      ) : (
        <p className="hold-stopped-note">已停用，暂时不能调整库存。</p>
      )}
      {props.canAdjust && (
        <HoldSpecificationActions
          specification={item}
          categoryActive={props.categoryActive}
          onChanged={props.onChanged}
        />
      )}
    </div>
  );
}

function ModelPlaceholder(props: { active: boolean; onAdd: () => void }) {
  return (
    <div className="hold-model-placeholder">
      <span>还没有 3D 模型</span>
      {props.active && <button onClick={props.onAdd}>添加模型</button>}
    </div>
  );
}

function SpecificationHeader({ specification }: { specification: HoldSpecification }) {
  return (
    <header>
      <span className="hold-color-swatch" style={{ background: specification.colorHex }} />
      <div>
        <b>
          {specification.productName}
          {specification.status === 'ARCHIVED' && <em>已停用</em>}
        </b>
        <small>
          {specification.colorName} · {specification.manufacturer ?? '品牌未填'}
        </small>
      </div>
      <strong>{specification.inventory.totalQuantity} 件</strong>
    </header>
  );
}

function SpecificationMetadata({ specification }: { specification: HoldSpecification }) {
  return (
    <div className="hold-specification-meta">
      <span>
        尺寸 <b>{specification.sizeClass}</b>
      </span>
      <span>
        固定 <b>{mountingLabel[specification.mountingType]}</b>
      </span>
      <span>
        货号 <b>{specification.sku ?? '未填'}</b>
      </span>
    </div>
  );
}

function InventoryGrid({ specification }: { specification: HoldSpecification }) {
  const inventory = specification.inventory;
  const items = [
    ['仓库', inventory.warehouseQuantity],
    ['上墙', inventory.installedQuantity],
    ['预留', inventory.reservedQuantity],
    ['维护', inventory.maintenanceQuantity],
  ];
  return (
    <div className="hold-inventory-grid">
      {items.map(([label, value]) => (
        <span key={label}>
          <small>{label}</small>
          <b>{value}</b>
        </span>
      ))}
    </div>
  );
}

export function filterHoldSpecifications(
  items: HoldSpecification[],
  filters: SpecificationFilters,
): HoldSpecification[] {
  const query = normalize(filters.query);
  return items.filter((item) => {
    const searchable = normalize(
      [item.productName, item.colorName, item.manufacturer, item.sku, item.style]
        .filter(Boolean)
        .join(' '),
    );
    return (
      (!query || searchable.includes(query)) &&
      (!filters.color || item.colorName === filters.color) &&
      (!filters.size || item.sizeClass === filters.size) &&
      (!filters.manufacturer || item.manufacturer === filters.manufacturer) &&
      matchesModel(item, filters.model) &&
      (filters.status === 'ALL' || item.status === filters.status)
    );
  });
}

function matchesModel(item: HoldSpecification, filter: ModelFilter): boolean {
  if (filter === 'ALL') return true;
  return filter === 'WITH_MODEL' ? hasModelAsset(item) : !hasModelAsset(item);
}

function hasModelAsset(specification: HoldSpecification): boolean {
  return specification.assets.some((asset) => asset.kind === 'MODEL_3D');
}

function buildFilterOptions(items: HoldSpecification[]) {
  return {
    colors: unique(items.map((item) => item.colorName)),
    sizes: unique(items.map((item) => item.sizeClass)),
    manufacturers: unique(
      items.map((item) => item.manufacturer).filter((value): value is string => Boolean(value)),
    ),
  };
}

function unique(values: string[]): string[] {
  return [...new Set(values)].sort((a, b) => a.localeCompare(b, 'zh-CN'));
}

function hasFilters(filters: SpecificationFilters): boolean {
  return Object.entries(filters).some(
    ([key, value]) => value !== emptySpecificationFilters[key as keyof SpecificationFilters],
  );
}

const normalize = (value: string) => value.trim().toLocaleLowerCase('zh-CN');
