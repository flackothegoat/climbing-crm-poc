import { CoreModuleCard, SectionCard, StatGrid } from '../../features/dashboard/page-components';

const overviewStats = [
  { label: '员工账号', value: '1', detail: '1 位 L1 管理员', tone: 'accent' as const },
  { label: '岩点库存', value: '实时', detail: '型号、颜色与库存流水' },
  { label: '数字墙面', value: '2', detail: '1 面待采集', tone: 'warning' as const },
  { label: '有效线路', value: '1', detail: '另有 2 条处理中' },
];

const readiness = [
  ['身份与权限', '已就绪', '账号、组织、L1/L2 角色和会话基础已建立'],
  ['员工管理', '已接入', '邀请、成员状态、固定权限和审计接口已建立'],
  ['岩点管理', '已接入', '型号目录、分色库存、入库校准和审计流水已建立'],
  ['墙面与线路', '结构已就绪', '页面与核心字段已规划，等待后续模块接入'],
];

export default function DashboardPage() {
  return (
    <div className="page-stack">
      <OverviewHero />
      <StatGrid items={overviewStats} />
      <section className="overview-grid">
        <SectionCard
          title="核心模块"
          description="POC 将围绕以下四个入口持续实现真实业务能力。"
          className="module-section"
        >
          <div className="core-module-grid">
            <CoreModuleCard
              href="/dashboard/team"
              icon="team"
              title="员工管理"
              description="账号、角色与职责"
              status="已接入"
            />
            <CoreModuleCard
              href="/dashboard/assets/holds"
              icon="holds"
              title="岩点"
              description="型号、库存与状态"
              status="已接入"
            />
            <CoreModuleCard
              href="/dashboard/assets/walls"
              icon="walls"
              title="墙面"
              description="空间、点位与版本"
              status="基础结构"
            />
            <CoreModuleCard
              href="/dashboard/assets/routes"
              icon="routes"
              title="定线"
              description="草稿、审核与发布"
              status="基础结构"
            />
          </div>
        </SectionCard>
        <SectionCard
          title="数字化准备度"
          description="POC 核心模块当前交付状态。"
          className="readiness-section"
        >
          <div className="readiness-list">
            {readiness.map(([label, status, detail]) => (
              <article key={label}>
                <span className="readiness-dot" />
                <div>
                  <strong>{label}</strong>
                  <p>{detail}</p>
                </div>
                <em>{status}</em>
              </article>
            ))}
          </div>
        </SectionCard>
      </section>
      <SectionCard
        title="建议演示路径"
        description="按核心数据的依赖顺序浏览，更容易理解后续功能如何衔接。"
      >
        <div className="demo-path">
          <span>1</span>
          <p>
            <strong>员工</strong>
            <small>确定操作者与权限</small>
          </p>
          <b>→</b>
          <span>2</span>
          <p>
            <strong>岩点</strong>
            <small>建立可用资产库存</small>
          </p>
          <b>→</b>
          <span>3</span>
          <p>
            <strong>墙面</strong>
            <small>建立空间和点位基线</small>
          </p>
          <b>→</b>
          <span>4</span>
          <p>
            <strong>线路</strong>
            <small>组合并发布定线成果</small>
          </p>
        </div>
      </SectionCard>
    </div>
  );
}

function OverviewHero() {
  return (
    <section className="overview-hero">
      <div className="overview-hero-copy">
        <p className="page-eyebrow">CLIMBING GYM · OPERATIONS</p>
        <h2>岩馆数字化看板</h2>
        <p>从人员与核心资产开始，让岩馆的每一次变化都有迹可循。</p>
        <span className="poc-badge is-inverse">
          <i />
          POC 环境
        </span>
      </div>
      <RouteVisual />
    </section>
  );
}

function RouteVisual() {
  return (
    <div className="overview-route-visual" aria-hidden="true">
      <svg viewBox="0 0 420 250" role="presentation">
        <path d="M58 230C65 177 100 185 119 145c21-45-10-71 32-106 36-30 79-1 106 39 29 43 47 16 82 51 27 27 29 65 23 101" />
        <circle cx="59" cy="229" r="8" />
        <circle cx="119" cy="145" r="8" />
        <circle cx="151" cy="39" r="8" />
        <circle cx="257" cy="78" r="8" />
        <circle cx="339" cy="129" r="8" />
        <circle cx="362" cy="230" r="8" />
      </svg>
      <span className="route-visual-label">
        <small>核心资产链路</small>
        <strong>人员 · 岩点 · 墙面 · 线路</strong>
      </span>
    </div>
  );
}
