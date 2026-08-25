'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import type { ReactNode } from 'react';
import { useState } from 'react';
import { apiRequest } from '../../lib/api';
import type { AuthenticatedSession } from '../../lib/server-session';
import { DashboardIcon } from './dashboard-icons';
import {
  assetNavigation,
  pageTitles,
  primaryNavigation,
  secondaryNavigation,
  type NavigationItem,
} from './dashboard-navigation';

interface DashboardShellProps {
  children: ReactNode;
  session: AuthenticatedSession;
}

export function DashboardShell({ children, session }: DashboardShellProps) {
  const pathname = usePathname();
  const [assetsOpen, setAssetsOpen] = useState(pathname.startsWith('/dashboard/assets'));
  const [mobileOpen, setMobileOpen] = useState(false);
  const [loggingOut, setLoggingOut] = useState(false);

  async function logout(): Promise<void> {
    setLoggingOut(true);
    try {
      await apiRequest<void>('/auth/logout', { method: 'POST' });
      window.location.assign('/');
    } catch {
      setLoggingOut(false);
    }
  }

  return (
    <div className="dashboard-shell">
      <Sidebar
        assetsOpen={assetsOpen}
        mobileOpen={mobileOpen}
        pathname={pathname}
        session={session}
        onAssetToggle={() => setAssetsOpen((value) => !value)}
        onNavigate={() => setMobileOpen(false)}
      />
      {mobileOpen && (
        <button
          className="sidebar-backdrop"
          aria-label="关闭导航"
          onClick={() => setMobileOpen(false)}
        />
      )}
      <section className="dashboard-workspace">
        <DashboardHeader
          loggingOut={loggingOut}
          pathname={pathname}
          session={session}
          onLogout={logout}
          onMenu={() => setMobileOpen(true)}
        />
        <main className="dashboard-main">{children}</main>
      </section>
    </div>
  );
}

interface SidebarProps {
  assetsOpen: boolean;
  mobileOpen: boolean;
  pathname: string;
  session: AuthenticatedSession;
  onAssetToggle: () => void;
  onNavigate: () => void;
}

function Sidebar(props: SidebarProps) {
  return (
    <aside className={`dashboard-sidebar ${props.mobileOpen ? 'is-open' : ''}`}>
      <Link className="dashboard-brand" href="/dashboard" onClick={props.onNavigate}>
        <span className="dashboard-brand-mark">↗</span>
        <span>
          <strong>Climbing</strong>
          <small>CRM</small>
        </span>
      </Link>
      <nav className="dashboard-navigation" aria-label="看板导航">
        <NavigationList
          items={primaryNavigation}
          pathname={props.pathname}
          onNavigate={props.onNavigate}
        />
        <AssetNavigation
          open={props.assetsOpen}
          pathname={props.pathname}
          onNavigate={props.onNavigate}
          onToggle={props.onAssetToggle}
        />
        <p className="navigation-label">系统管理</p>
        <NavigationList
          items={secondaryNavigation}
          pathname={props.pathname}
          onNavigate={props.onNavigate}
        />
      </nav>
      <div className="sidebar-profile">
        <span className="profile-avatar">{props.session.organization.name.slice(0, 1)}</span>
        <span>
          <strong>{props.session.membership.displayName ?? props.session.organization.name}</strong>
          <small>{roleLabel(props.session.role)}</small>
        </span>
      </div>
    </aside>
  );
}

function NavigationList({
  items,
  pathname,
  onNavigate,
}: {
  items: NavigationItem[];
  pathname: string;
  onNavigate: () => void;
}) {
  return (
    <>
      {items.map((item) => (
        <NavigationLink
          item={item}
          key={item.href}
          active={pathname === item.href}
          onNavigate={onNavigate}
        />
      ))}
    </>
  );
}

function NavigationLink({
  item,
  active,
  onNavigate,
}: {
  item: NavigationItem;
  active: boolean;
  onNavigate: () => void;
}) {
  return (
    <Link
      aria-current={active ? 'page' : undefined}
      className={`navigation-item ${active ? 'is-active' : ''}`}
      href={item.href}
      onClick={onNavigate}
    >
      <DashboardIcon name={item.icon} />
      <span>{item.label}</span>
    </Link>
  );
}

function AssetNavigation({
  open,
  pathname,
  onNavigate,
  onToggle,
}: {
  open: boolean;
  pathname: string;
  onNavigate: () => void;
  onToggle: () => void;
}) {
  const active = pathname.startsWith('/dashboard/assets');
  return (
    <div className="navigation-group">
      <button
        className={`navigation-item navigation-toggle ${active ? 'is-active' : ''}`}
        type="button"
        aria-expanded={open}
        onClick={onToggle}
      >
        <DashboardIcon name="assets" />
        <span>业务模块</span>
        <DashboardIcon className={`navigation-chevron ${open ? 'is-open' : ''}`} name="chevron" />
      </button>
      {open && (
        <div className="navigation-children">
          <NavigationList items={assetNavigation} pathname={pathname} onNavigate={onNavigate} />
        </div>
      )}
    </div>
  );
}

function DashboardHeader({
  loggingOut,
  pathname,
  session,
  onLogout,
  onMenu,
}: {
  loggingOut: boolean;
  pathname: string;
  session: AuthenticatedSession;
  onLogout: () => void;
  onMenu: () => void;
}) {
  return (
    <header className="dashboard-header">
      <button className="mobile-menu-button" type="button" aria-label="打开导航" onClick={onMenu}>
        <DashboardIcon name="menu" />
      </button>
      <div>
        <p>工作空间</p>
        <h1>{pageTitles[pathname] ?? '攀岩馆管理'}</h1>
      </div>
      <div className="header-actions">
        <span className="organization-pill">{session.organization.name}</span>
        <button className="logout-button" disabled={loggingOut} type="button" onClick={onLogout}>
          <DashboardIcon name="logout" />
          {loggingOut ? '退出中…' : '退出'}
        </button>
      </div>
    </header>
  );
}

function roleLabel(role: AuthenticatedSession['role']): string {
  return role === 'L1_ADMIN' ? 'L1 管理员' : 'L2 员工';
}
