import type { CorePageConfig } from './core-page-configs';
import { DashboardIcon } from './dashboard-icons';
import { PageHeading, SectionCard, StatGrid, StatusBadge } from './page-components';

export function CoreManagementPage({ config }: { config: CorePageConfig }) {
  return (
    <div className="page-stack">
      <PageHeading
        eyebrow={config.eyebrow}
        title={config.title}
        description={config.description}
        aside={
          <button className="page-action" disabled title="将在后续功能模块中接入">
            <DashboardIcon name={config.icon} />
            {config.actionLabel}
            <small>即将接入</small>
          </button>
        }
      />
      <StatGrid items={config.stats} />
      <section className="core-content-grid">
        <SectionCard
          title={`${config.title}目录`}
          description="当前为用于验证信息架构的演示数据，后续将替换为真实数据库记录。"
          className="table-card"
        >
          <ManagementTable config={config} />
        </SectionCard>
        <SectionCard
          title="后续业务链路"
          description="页面与数据边界已按以下顺序预留。"
          className="workflow-card"
        >
          <ol className="workflow-list">
            {config.workflow.map((step, index) => (
              <li key={step}>
                <span>{index + 1}</span>
                <p>{step}</p>
              </li>
            ))}
          </ol>
        </SectionCard>
      </section>
    </div>
  );
}

function ManagementTable({ config }: { config: CorePageConfig }) {
  return (
    <div className="management-table-wrap">
      <table className="management-table">
        <thead>
          <tr>
            {config.columns.map((column) => (
              <th key={column.key}>{column.label}</th>
            ))}
          </tr>
        </thead>
        <tbody>
          {config.rows.map((row, index) => (
            <ManagementRow columns={config.columns} key={`${config.title}-${index}`} row={row} />
          ))}
        </tbody>
      </table>
    </div>
  );
}

function ManagementRow({
  columns,
  row,
}: Pick<CorePageConfig, 'columns'> & { row: Record<string, string> }) {
  return (
    <tr>
      {columns.map((column) => (
        <td key={column.key}>
          {column.status ? <StatusBadge value={row[column.key]} /> : row[column.key]}
        </td>
      ))}
    </tr>
  );
}
