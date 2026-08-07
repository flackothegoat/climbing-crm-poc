import Link from 'next/link';
import type { ReactNode } from 'react';
import { DashboardIcon, type IconName } from './dashboard-icons';

export interface StatItem {
  label: string;
  value: string;
  detail: string;
  tone?: 'accent' | 'neutral' | 'warning';
}

export function PageHeading({
  eyebrow,
  title,
  description,
  aside,
}: {
  eyebrow: string;
  title: string;
  description: string;
  aside?: ReactNode;
}) {
  return (
    <header className="page-heading">
      <div>
        <p className="page-eyebrow">{eyebrow}</p>
        <h2>{title}</h2>
        <p>{description}</p>
      </div>
      {aside}
    </header>
  );
}

export function StatGrid({ items }: { items: StatItem[] }) {
  return (
    <section className="stat-grid" aria-label="关键指标">
      {items.map((item) => (
        <article className={`stat-card tone-${item.tone ?? 'neutral'}`} key={item.label}>
          <p>{item.label}</p>
          <strong>{item.value}</strong>
          <span>{item.detail}</span>
        </article>
      ))}
    </section>
  );
}

export function SectionCard({
  title,
  description,
  children,
  className = '',
}: {
  title: string;
  description?: string;
  children: ReactNode;
  className?: string;
}) {
  return (
    <section className={`section-card ${className}`}>
      <header>
        <div>
          <h3>{title}</h3>
          {description && <p>{description}</p>}
        </div>
      </header>
      {children}
    </section>
  );
}

export function CoreModuleCard({
  href,
  icon,
  title,
  description,
  status,
}: {
  href: string;
  icon: IconName;
  title: string;
  description: string;
  status: string;
}) {
  return (
    <Link className="core-module-card" href={href}>
      <span className="module-icon">
        <DashboardIcon name={icon} />
      </span>
      <span>
        <strong>{title}</strong>
        <small>{description}</small>
      </span>
      <em>{status}</em>
      <span className="module-arrow">→</span>
    </Link>
  );
}

export function StatusBadge({ value }: { value: string }) {
  const tone =
    value.includes('正常') || value.includes('在岗') || value.includes('已发布')
      ? 'success'
      : value.includes('待') || value.includes('草稿')
        ? 'warning'
        : 'neutral';
  return <span className={`status-badge status-${tone}`}>{value}</span>;
}
