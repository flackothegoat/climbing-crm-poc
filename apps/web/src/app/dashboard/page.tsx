import { CoreModuleCard, SectionCard, StatGrid } from '../../features/dashboard/page-components';

const overviewStats = [
  {
    label: '第一阶段主线',
    value: '已接入',
    detail: '线路建档、发布与下线',
    tone: 'accent' as const,
  },
  { label: '会员入口', value: 'QR', detail: '匿名 10 秒反馈' },
  { label: '运营数据', value: '分来源', detail: '样本量与指标边界' },
  { label: '摄像头', value: '增强项', detail: '不阻塞二维码闭环', tone: 'warning' as const },
];

const readiness = [
  ['身份与权限', '已就绪', '账号、组织、L1/L2 角色和会话基础已建立'],
  ['员工管理', '已接入', '邀请、成员状态、固定权限和审计接口已建立'],
  ['线路运营', '已接入', '跨墙段建档、版本发布、二维码和历史下线已建立'],
  ['反馈与复盘', '已接入', '难度、喜好、安全疑虑、样本置信度和透明建议已建立'],
];

export default function DashboardPage() {
  return (
    <div className="page-stack">
      <OverviewHero />
      <StatGrid items={overviewStats} />
      <section className="overview-grid">
        <SectionCard
          title="核心模块"
          description="第一阶段以线路为中心；资产和三维能力作为后续增强。"
          className="module-section"
        >
          <div className="core-module-grid">
            <CoreModuleCard
              href="/dashboard/assets/routes"
              icon="routes"
              title="线路运营"
              description="建档、发布与二维码"
              status="已接入"
            />
            <CoreModuleCard
              href="/dashboard/data"
              icon="data"
              title="线路数据"
              description="反馈、置信度与复盘"
              status="已接入"
            />
            <CoreModuleCard
              href="/dashboard/assets/walls"
              icon="walls"
              title="墙面"
              description="区域、墙段与定位"
              status="可复用"
            />
            <CoreModuleCard
              href="/dashboard/assets/holds"
              icon="holds"
              title="岩点资产"
              description="库存与 3D 增强"
              status="第二阶段"
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
        title="第一阶段演示路径"
        description="不依赖摄像头、GLB 或精确孔位即可完成一条真实业务闭环。"
      >
        <div className="demo-path">
          <span>1</span>
          <p>
            <strong>线路建档</strong>
            <small>墙段、难度、照片与定线员</small>
          </p>
          <b>→</b>
          <span>2</span>
          <p>
            <strong>发布二维码</strong>
            <small>生成可打印会员入口</small>
          </p>
          <b>→</b>
          <span>3</span>
          <p>
            <strong>会员反馈</strong>
            <small>完攀、难度、喜好与安全</small>
          </p>
          <b>→</b>
          <span>4</span>
          <p>
            <strong>线路复盘</strong>
            <small>按样本量辅助保留或调整</small>
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
        <h2>线路运营数字化底座</h2>
        <p>先让每次定线都能被记录、反馈、分析和复盘，再逐步接入摄像头与 AI。</p>
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
        <small>第一阶段数据闭环</small>
        <strong>线路 · 反馈 · 完攀 · 换线复盘</strong>
      </span>
    </div>
  );
}
