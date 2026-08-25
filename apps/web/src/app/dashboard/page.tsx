import { CoreModuleCard, SectionCard, StatGrid } from '../../features/dashboard/page-components';

const overviewStats = [
  {
    label: '岩点资产',
    value: '可管理',
    detail: '档案、数量、状态与模型',
    tone: 'accent' as const,
  },
  { label: '线路档案', value: '可发布', detail: '位置、二维码与生命周期' },
  { label: '会员反馈', value: 'QR', detail: '匿名 10 秒反馈' },
  { label: '试点区域', value: 'W03–W05', detail: '线路视觉定位', tone: 'warning' as const },
];

const readiness = [
  ['岩点库', '主线', '同款岩点只建一份档案，数量按仓库、上墙和维护状态管理'],
  ['线路库', '主线', '线路建档、墙段位置、发布、二维码反馈和下线历史'],
  ['W03–W05 视觉', '试点', '选择线路后保留原色岩点、显示黄色轮廓和 S/T'],
];

export default function DashboardPage() {
  return (
    <div className="page-stack">
      <OverviewHero />
      <StatGrid items={overviewStats} />
      <section className="overview-grid">
        <SectionCard
          title="核心模块"
          description="系统只保留两条业务主线，其他能力不进入当前产品界面。"
          className="module-section"
        >
          <div className="core-module-grid">
            <CoreModuleCard
              href="/dashboard/assets/holds"
              icon="holds"
              title="岩点库"
              description="档案、库存、照片与 3D"
              status="客户需求"
            />
            <CoreModuleCard
              href="/dashboard/assets/routes"
              icon="routes"
              title="线路库"
              description="建档、视觉、反馈与复盘"
              status="第一阶段"
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
        title="当前演示路径"
        description="先展示两条独立主线的真实价值，再逐步建立可选关联。"
      >
        <div className="demo-path">
          <span>1</span>
          <p>
            <strong>岩点入库</strong>
            <small>同款建档一次，记录数量与状态</small>
          </p>
          <b>→</b>
          <span>2</span>
          <p>
            <strong>线路建档</strong>
            <small>关联 W03–W05 墙段并确认视觉位置</small>
          </p>
          <b>→</b>
          <span>3</span>
          <p>
            <strong>发布与反馈</strong>
            <small>二维码收集完攀、难度与喜好</small>
          </p>
          <b>→</b>
          <span>4</span>
          <p>
            <strong>查看结果</strong>
            <small>库存清晰，线路表现可复盘</small>
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
        <p className="page-eyebrow">CLIMBING GYM · DIGITAL FOUNDATION</p>
        <h2>岩点库与线路库</h2>
        <p>先把岩馆有什么岩点、正在运营什么线路说明白，再积累反馈和后续智能能力。</p>
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
        <small>当前产品范围</small>
        <strong>岩点资产 · 线路视觉 · 会员反馈</strong>
      </span>
    </div>
  );
}
