import type { IconName } from './dashboard-icons';

export interface NavigationItem {
  href: string;
  icon: IconName;
  label: string;
}

export const primaryNavigation: NavigationItem[] = [
  { href: '/dashboard', icon: 'overview', label: '总览' },
  { href: '/dashboard/camera', icon: 'camera', label: '视频识别' },
];

export const assetNavigation: NavigationItem[] = [
  { href: '/dashboard/assets/holds', icon: 'holds', label: '岩点库' },
  { href: '/dashboard/assets/routes', icon: 'routes', label: '线路库' },
];

export const secondaryNavigation: NavigationItem[] = [
  { href: '/dashboard/team', icon: 'team', label: '员工管理' },
];

export const pageTitles: Record<string, string> = {
  '/dashboard': '数字化看板',
  '/dashboard/team': '员工管理',
  '/dashboard/assets/holds': '岩点库',
  '/dashboard/assets/routes': '线路库',
  '/dashboard/camera': '视频识别',
  ...Object.fromEntries(secondaryNavigation.map((item) => [item.href, item.label])),
};
