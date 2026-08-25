import { climbingColorCss, climbingColorLabel } from '../common/climbing-colors';
import type { HoldCategory, HoldSpecification } from './hold-api';
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
    <section className="section-card table-card hold-directory-card">
      <header>
        <div>
          <h3>岩点档案</h3>
          <p>一行代表一种可计数的岩点；同款实物通过数量管理，不重复建立档案。</p>
        </div>
      </header>
      {props.loading ? (
        <p className="table-empty-state">正在加载岩点档案…</p>
      ) : items.length ? (
        <CatalogTable items={items} onSelect={props.onSelect} />
      ) : (
        <p className="table-empty-state">还没有符合条件的岩点档案。</p>
      )}
    </section>
  );
}

function CatalogTable(props: {
  items: CatalogItem[];
  onSelect: (category: HoldCategory, specification: HoldSpecification) => void;
}) {
  return (
    <div className="management-table-wrap">
      <table className="management-table hold-table">
        <thead>
          <tr>
            <th>岩点</th>
            <th>品牌</th>
            <th>类型 / 尺寸</th>
            <th>仓库</th>
            <th>上墙</th>
            <th>维护</th>
            <th>总量</th>
            <th>模型</th>
            <th aria-label="操作" />
          </tr>
        </thead>
        <tbody>
          {props.items.map((item) => (
            <CatalogRow item={item} key={item.specification.id} onSelect={props.onSelect} />
          ))}
        </tbody>
      </table>
    </div>
  );
}

function CatalogRow(props: {
  item: CatalogItem;
  onSelect: (category: HoldCategory, specification: HoldSpecification) => void;
}) {
  const { category, specification } = props.item;
  const inventory = specification.inventory;
  const hasModel = specification.assets.some((asset) => asset.kind === 'MODEL_3D');
  return (
    <tr className={specification.status === 'ARCHIVED' ? 'is-archived' : ''}>
      <td>
        <span className="hold-model-cell">
          <i style={{ background: climbingColorCss(specification.color) }} />
          <span>
            <b>{specification.productName}</b>
            <small>
              {climbingColorLabel(specification.color)}
              {specification.status === 'ARCHIVED' ? ' · 已停用' : ''}
            </small>
          </span>
        </span>
      </td>
      <td>{specification.manufacturer ?? '未填写'}</td>
      <td>
        <span className="table-primary">{gripLabel[category.gripType]}</span>
        <small>{specification.sizeClass}</small>
      </td>
      <td className="quantity-cell">{inventory.warehouseQuantity}</td>
      <td className="quantity-cell">{inventory.installedQuantity}</td>
      <td className="quantity-cell">{inventory.maintenanceQuantity}</td>
      <td className="quantity-cell quantity-total">{inventory.totalQuantity}</td>
      <td>{hasModel ? '可查看 3D' : '待补模型'}</td>
      <td>
        <button className="table-action" onClick={() => props.onSelect(category, specification)}>
          查看档案
        </button>
      </td>
    </tr>
  );
}
