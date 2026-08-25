import type { HoldCategory } from './hold-api';
import { climbingColorCss, climbingColorLabel } from '../common/climbing-colors';
import { gripEnglishLabel, gripLabel } from './hold-options';

export function HoldTable(props: {
  categories: HoldCategory[];
  loading: boolean;
  onSelect: (category: HoldCategory) => void;
}) {
  return (
    <section className="section-card table-card hold-directory-card">
      <header>
        <div>
          <h3>岩点档案目录</h3>
          <p>先选用途，再查看对应的岩点和库存。</p>
        </div>
      </header>
      {props.loading ? (
        <p className="table-empty-state">正在加载岩点分类…</p>
      ) : props.categories.length ? (
        <CategoryTable categories={props.categories} onSelect={props.onSelect} />
      ) : (
        <p className="table-empty-state">还没有符合条件的岩点档案。</p>
      )}
    </section>
  );
}

function CategoryTable(props: {
  categories: HoldCategory[];
  onSelect: (category: HoldCategory) => void;
}) {
  return (
    <div className="management-table-wrap">
      <table className="management-table hold-table">
        <thead>
          <tr>
            <th>用途分类</th>
            <th>档案</th>
            <th>颜色预览</th>
            <th>仓库</th>
            <th>上墙</th>
            <th>预留</th>
            <th>总量</th>
            <th aria-label="操作" />
          </tr>
        </thead>
        <tbody>
          {props.categories.map((category) => (
            <CategoryRow category={category} key={category.id} onSelect={props.onSelect} />
          ))}
        </tbody>
      </table>
    </div>
  );
}

function CategoryRow(props: {
  category: HoldCategory;
  onSelect: (category: HoldCategory) => void;
}) {
  const category = props.category;
  return (
    <tr className={category.status === 'ARCHIVED' ? 'is-archived' : ''}>
      <td>
        <span className="hold-model-cell">
          <i>{category.name.slice(0, 2)}</i>
          <span>
            <b className="hold-grip-heading">
              {category.name}
              <small className="hold-grip-english">{gripEnglishLabel[category.gripType]}</small>
            </b>
            <small>
              {categoryCodeLabel(category)}
              {category.status === 'ARCHIVED' ? ' · 已停用' : ''}
            </small>
          </span>
        </span>
      </td>
      <td>
        <span className="table-primary">{category.activeSpecificationCount}</span>
        <small>个启用档案</small>
        {category.stoppedSpecificationCount > 0 && (
          <small>{category.stoppedSpecificationCount} 个已停用档案</small>
        )}
      </td>
      <td>
        <SpecificationColors category={category} />
      </td>
      <td className="quantity-cell">{category.inventory.warehouseQuantity}</td>
      <td className="quantity-cell">{category.inventory.installedQuantity}</td>
      <td className="quantity-cell">{category.inventory.reservedQuantity}</td>
      <td className="quantity-cell quantity-total">{category.inventory.totalQuantity}</td>
      <td>
        <button className="table-action" onClick={() => props.onSelect(category)}>
          查看档案
        </button>
      </td>
    </tr>
  );
}

function categoryCodeLabel(category: HoldCategory): string {
  return category.source === 'DEFAULT'
    ? '系统分类'
    : `${category.code} · ${gripLabel[category.gripType]}`;
}

function SpecificationColors({ category }: { category: HoldCategory }) {
  return (
    <span className="hold-color-list">
      {category.specifications.slice(0, 4).map((item) => (
        <i
          key={item.id}
          style={{ background: climbingColorCss(item.color) }}
          title={`${item.productName} · ${climbingColorLabel(item.color)}`}
        />
      ))}
      {category.specifications.length > 4 && <small>+{category.specifications.length - 4}</small>}
      {!category.specifications.length && <small>暂无档案</small>}
    </span>
  );
}
