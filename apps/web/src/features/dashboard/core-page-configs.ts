import type { IconName } from './dashboard-icons';
import type { StatItem } from './page-components';

export interface TableColumn {
  key: string;
  label: string;
  status?: boolean;
}

export interface CorePageConfig {
  actionLabel: string;
  columns: TableColumn[];
  description: string;
  eyebrow: string;
  icon: IconName;
  rows: Array<Record<string, string>>;
  stats: StatItem[];
  title: string;
  workflow: string[];
}

export const wallPageConfig: CorePageConfig = {
  actionLabel: '新增墙面',
  columns: [
    { key: 'name', label: '墙面' },
    { key: 'area', label: '区域' },
    { key: 'size', label: '物理尺寸' },
    { key: 'grid', label: '点位网格' },
    { key: 'routes', label: '有效线路' },
    { key: 'status', label: '状态', status: true },
  ],
  description: '沉淀墙面尺寸、照片、点位与配置版本，作为数字化定线和线路生命周期的空间基础。',
  eyebrow: '核心模块 · 资产',
  icon: 'walls',
  rows: [
    {
      name: '主厅 A 墙',
      area: '抱石区',
      size: '12.0 × 4.5 m',
      grid: '18 × 12',
      routes: '6 条',
      status: '配置正常',
    },
    {
      name: '训练区 B 墙',
      area: '训练区',
      size: '8.0 × 4.2 m',
      grid: '12 × 10',
      routes: '3 条',
      status: '待采集',
    },
  ],
  stats: [
    { label: '墙面', value: '2', detail: '演示数据', tone: 'accent' },
    { label: '可用点位', value: '336', detail: '数字化网格' },
    { label: '待采集', value: '1', detail: '面墙', tone: 'warning' },
  ],
  title: '墙面资产',
  workflow: ['创建墙面档案', '采集基准照片与尺寸', '配置点位网格', '发布有效墙面版本'],
};

export const routePageConfig: CorePageConfig = {
  actionLabel: '新建线路',
  columns: [
    { key: 'name', label: '线路' },
    { key: 'wall', label: '所在墙面' },
    { key: 'grade', label: '难度' },
    { key: 'setter', label: '定线员' },
    { key: 'updated', label: '更新时间' },
    { key: 'status', label: '状态', status: true },
  ],
  description: '围绕墙面与岩点建立线路草稿、审核、发布和下线流程，让每次定线变更都有记录。',
  eyebrow: '核心模块 · 资产',
  icon: 'routes',
  rows: [
    {
      name: '晨雾',
      wall: '主厅 A 墙',
      grade: 'V3',
      setter: '示例员工 A',
      updated: '今天',
      status: '草稿',
    },
    {
      name: '折线',
      wall: '主厅 A 墙',
      grade: 'V5',
      setter: '当前账号',
      updated: '昨天',
      status: '已发布',
    },
    {
      name: '小跳步',
      wall: '训练区 B 墙',
      grade: 'V2',
      setter: '示例员工 A',
      updated: '3 天前',
      status: '待审核',
    },
  ],
  stats: [
    { label: '有效线路', value: '1', detail: '已发布', tone: 'accent' },
    { label: '草稿', value: '1', detail: '持续编辑中' },
    { label: '待审核', value: '1', detail: '需要 L1 确认', tone: 'warning' },
  ],
  title: '线路资产',
  workflow: ['选择有效墙面版本', '在点位网格编排岩点', '提交审核', '发布并记录线路生命周期'],
};
