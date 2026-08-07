import type { SVGProps } from 'react';

export type IconName =
  | 'overview'
  | 'team'
  | 'assets'
  | 'holds'
  | 'walls'
  | 'routes'
  | 'calendar'
  | 'marketing'
  | 'data'
  | 'settings'
  | 'chevron'
  | 'menu'
  | 'logout';

const ICON_PATHS: Record<IconName, string[]> = {
  overview: ['M4 13h6V4H4v9Z', 'M14 20h6v-9h-6v9Z', 'M4 20h6v-3H4v3Z', 'M14 7h6V4h-6v3Z'],
  team: [
    'M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2',
    'M9 11a4 4 0 1 0 0-8 4 4 0 0 0 0 8Z',
    'M22 21v-2a4 4 0 0 0-3-3.87',
    'M16 3.13a4 4 0 0 1 0 7.75',
  ],
  assets: [
    'M21 16V8a2 2 0 0 0-1-1.73l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.73l7 4a2 2 0 0 0 2 0l7-4A2 2 0 0 0 21 16Z',
    'm3.3 7 8.7 5 8.7-5',
    'M12 22V12',
  ],
  holds: ['M8 3h8l3 5-3 6H8l-3-4 3-7Z', 'M9 18h6'],
  walls: ['M4 21V5l16-2v18', 'M4 9h16', 'M8 13h2', 'M14 16h2'],
  routes: ['M6 19c5-1 2-7 7-8s2-5 5-7', 'M5 19h2v2H5z', 'M17 3h2v2h-2z'],
  calendar: ['M3 5h18v16H3z', 'M16 3v4', 'M8 3v4', 'M3 10h18'],
  marketing: ['M3 11v2', 'M6 9v6l11 4V5L6 9Z', 'M8 15l2 6'],
  data: ['M4 19V9', 'M10 19V5', 'M16 19v-7', 'M22 19H2'],
  settings: [
    'M12 15.5a3.5 3.5 0 1 0 0-7 3.5 3.5 0 0 0 0 7Z',
    'M19.4 15a1.7 1.7 0 0 0 .34 1.88l.06.06-2.12 2.12-.06-.06a1.7 1.7 0 0 0-1.88-.34 1.7 1.7 0 0 0-1 1.55V20h-3v-.09a1.7 1.7 0 0 0-1-1.55 1.7 1.7 0 0 0-1.88.34l-.06.06-2.12-2.12.06-.06A1.7 1.7 0 0 0 6.6 15a1.7 1.7 0 0 0-1.55-1H5v-3h.09a1.7 1.7 0 0 0 1.55-1A1.7 1.7 0 0 0 6.3 8.1l-.06-.06 2.12-2.12.06.06a1.7 1.7 0 0 0 1.88.34A1.7 1.7 0 0 0 11.3 4.8V4h3v.09a1.7 1.7 0 0 0 1 1.55 1.7 1.7 0 0 0 1.88-.34l.06-.06 2.12 2.12-.06.06A1.7 1.7 0 0 0 19 9.3a1.7 1.7 0 0 0 1.55 1H21v3h-.09A1.7 1.7 0 0 0 19.4 15Z',
  ],
  chevron: ['m9 18 6-6-6-6'],
  menu: ['M4 7h16', 'M4 12h16', 'M4 17h16'],
  logout: ['M10 17l5-5-5-5', 'M15 12H3', 'M21 19V5a2 2 0 0 0-2-2h-6'],
};

export function DashboardIcon({ name, ...props }: SVGProps<SVGSVGElement> & { name: IconName }) {
  return (
    <svg
      aria-hidden="true"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.8"
      strokeLinecap="round"
      strokeLinejoin="round"
      {...props}
    >
      {ICON_PATHS[name].map((path) => (
        <path d={path} key={path} />
      ))}
    </svg>
  );
}
