import { climbingColorCss, climbingColorLabel } from '../common/climbing-colors';
import type { HoldCategory, HoldSpecification } from './hold-api';
import { HoldCatalogPreview } from './hold-model-viewer';
import { gripLabel } from './hold-options';

interface CatalogItem {
  category: HoldCategory;
  specification: HoldSpecification;
}

export function HoldTable(props: {
  categories: HoldCategory[];
  loading: boolean;
  onSelect: (category: HoldCategory, specification: HoldSpecification) => void;
}) {
  const items = props.categories.flatMap((category) =>
    category.specifications.map((specification) => ({ category, specification })),
  );
  return (
    <section className="section-card hold-directory-card">
      <header className="hold-directory-heading">
        <div>
          <h3>岩点档案</h3>
          <p>按模型快速找到岩点，点击卡片查看这个岩点的完整档案。</p>
        </div>
        <span>{items.length} 个档案</span>
      </header>
      {props.loading ? (
        <p className="table-empty-state">正在加载岩点档案…</p>
      ) : items.length ? (
        <CatalogGrid items={items} onSelect={props.onSelect} />
      ) : (
        <p className="table-empty-state">还没有符合条件的岩点档案。</p>
      )}
    </section>
  );
}

function CatalogGrid(props: {
  items: CatalogItem[];
  onSelect: (category: HoldCategory, specification: HoldSpecification) => void;
}) {
  return (
    <div className="hold-catalog-grid">
      {props.items.map((item) => (
        <CatalogCard item={item} key={item.specification.id} onSelect={props.onSelect} />
      ))}
    </div>
  );
}

function CatalogCard(props: {
  item: CatalogItem;
  onSelect: (category: HoldCategory, specification: HoldSpecification) => void;
}) {
  const { category, specification } = props.item;
  return (
    <button
      className={`hold-catalog-card ${specification.status === 'ARCHIVED' ? 'is-archived' : ''}`}
      onClick={() => props.onSelect(category, specification)}
      type="button"
    >
      <span className="hold-catalog-visual">
        <HoldCatalogPreview
          alt={`${specification.productName} 正立面预览`}
          assets={specification.assets}
          fallbackColor={climbingColorCss(specification.color)}
        />
        <small>{climbingColorLabel(specification.color)}</small>
        {specification.status === 'ARCHIVED' && <em>已停用</em>}
      </span>
      <span className="hold-catalog-copy">
        <strong>{specification.productName}</strong>
        <small>{specification.manufacturer || '品牌未填'}</small>
        <span>
          <small>
            {gripLabel[category.gripType]} · {specification.sizeClass}
          </small>
          <b>总数 {specification.inventory.totalQuantity}</b>
        </span>
      </span>
    </button>
  );
}
