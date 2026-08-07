import { notFound } from 'next/navigation';
import { DashboardIcon, type IconName } from '../../../features/dashboard/dashboard-icons';
import { PageHeading, SectionCard } from '../../../features/dashboard/page-components';

const dummySections: Record<string, { title: string; description: string; icon: IconName }> = {
  schedule: {
    title: '日程',
    description: '未来用于员工排班、定线计划和维护窗口管理。',
    icon: 'calendar',
  },
  marketing: {
    title: '营销',
    description: '未来用于活动、会员触达和内容运营。',
    icon: 'marketing',
  },
  data: { title: '数据', description: '未来用于运营指标、线路反馈和资产分析。', icon: 'data' },
  settings: {
    title: '设置',
    description: '未来用于岩馆资料、权限策略和系统参数配置。',
    icon: 'settings',
  },
};

export default async function DummySectionPage({
  params,
}: {
  params: Promise<{ section: string }>;
}) {
  const section = dummySections[(await params).section];
  if (!section) notFound();
  return (
    <div className="page-stack">
      <PageHeading
        eyebrow="辅助模块 · DUMMY"
        title={section.title}
        description={section.description}
      />
      <SectionCard title="暂不纳入 POC 演示">
        <div className="dummy-state">
          <span>
            <DashboardIcon name={section.icon} />
          </span>
          <h3>{section.title}模块已预留</h3>
          <p>当前仅验证导航和页面边界，不包含数据模型、API 或交互功能。</p>
          <em>后续按业务优先级启用</em>
        </div>
      </SectionCard>
    </div>
  );
}
