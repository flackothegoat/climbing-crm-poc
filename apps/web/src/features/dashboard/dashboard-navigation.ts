import type { IconName } from './dashboard-icons';

export interface NavigationItem {
  href: string;
  icon: IconName;
  label: string;
  dummy?: boolean;
}

export const primaryNavigation: NavigationItem[] = [
  { href: '/dashboard', icon: 'overview', label: '总览' },
  { href: '/dashboard/team', icon: 'team', label: '员工管理' },
];

export const assetNavigation: NavigationItem[] = [
  { href: '/dashboard/assets/holds', icon: 'holds', label: '岩点' },
  { href: '/dashboard/assets/walls', icon: 'walls', label: '墙面' },
  { href: '/dashboard/assets/routes', icon: 'routes', label: '定线' },
];

export const secondaryNavigation: NavigationItem[] = [
  { href: '/dashboard/schedule', icon: 'calendar', label: '日程', dummy: true },
  { href: '/dashboard/marketing', icon: 'marketing', label: '营销', dummy: true },
  { href: '/dashboard/data', icon: 'data', label: '数据', dummy: true },
  { href: '/dashboard/settings', icon: 'settings', label: '设置', dummy: true },
];

export const pageTitles: Record<string, string> = {
  '/dashboard': '数字化看板',
  '/dashboard/team': '员工管理',
  '/dashboard/assets/holds': '岩点资产',
  '/dashboard/assets/walls': '墙面资产',
  '/dashboard/assets/routes': '定线工作台',
  ...Object.fromEntries(secondaryNavigation.map((item) => [item.href, item.label])),
};
