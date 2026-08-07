import type { ReactNode } from 'react';
import { DashboardShell } from '../../features/dashboard/dashboard-shell';
import { requireSession } from '../../lib/server-session';
import './dashboard.css';

export default async function DashboardLayout({ children }: Readonly<{ children: ReactNode }>) {
  const session = await requireSession();
  return <DashboardShell session={session}>{children}</DashboardShell>;
}
