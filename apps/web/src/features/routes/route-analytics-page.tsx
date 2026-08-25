'use client';

import Link from 'next/link';
import { useEffect, useState } from 'react';
import { PageHeading, SectionCard, StatGrid } from '../dashboard/page-components';
import { climbingColorCss } from '../common/climbing-colors';
import { getRouteAnalytics, type RouteAnalytics } from './route-operations-api';
import styles from './routes.module.css';

export function RouteAnalyticsPage() {
  const [data, setData] = useState<RouteAnalytics | null>(null);
  const [error, setError] = useState('');

  useEffect(() => {
    getRouteAnalytics()
      .then(setData)
      .catch((cause: unknown) =>
        setError(cause instanceof Error ? cause.message : '线路数据加载失败'),
      );
  }, []);

  return (
    <div className="page-stack">
      <PageHeading
        eyebrow="第一阶段 · 二维码反馈"
        title="线路表现"
        description="用清晰的数据来源和样本量辅助换线复盘，不把主动反馈包装成全馆真实客流。"
        aside={
          <Link className={styles.secondaryButton} href="/dashboard/assets/routes">
            管理线路与二维码
          </Link>
        }
      />
      <StatGrid
        items={[
          {
            label: '在线线路',
            value: String(data?.totals.activeRoutes ?? '—'),
            detail: '当前可扫码反馈',
            tone: 'accent',
          },
          {
            label: '反馈样本',
            value: String(data?.totals.feedback ?? '—'),
            detail: '会员主动提交',
          },
          {
            label: '安全疑虑',
            value: String(data?.totals.safetyConcerns ?? '—'),
            detail: '需要人工优先复核',
            tone: (data?.totals.safetyConcerns ?? 0) > 0 ? 'warning' : 'neutral',
          },
          {
            label: '历史版本',
            value: String(data?.totals.routeVersions ?? '—'),
            detail: '发布与下线版本分开统计',
          },
        ]}
      />
      {error && <p className="team-feedback is-error">{error}</p>}
      <div className={styles.metricNotice}>
        <strong>指标边界</strong>
        <p>{data?.scope.metricNotice ?? '正在读取指标口径…'}</p>
      </div>
      <SectionCard
        title="逐线路反馈"
        description="建议由透明规则生成；样本少于 10 份时只提示继续收集。"
      >
        {!data ? (
          <p className={styles.empty}>正在聚合反馈…</p>
        ) : data.items.length ? (
          <div className={styles.analyticsList}>
            {data.items.map((item) => (
              <article className={styles.analyticsRow} key={item.routeVersionId}>
                <div className={styles.analyticsIdentity}>
                  <span
                    style={{ background: item.color ? climbingColorCss(item.color) : '#8da097' }}
                  />
                  <div>
                    <small>
                      {item.routeCode} · V{item.versionNumber}
                    </small>
                    <strong>{item.routeName}</strong>
                    <em>
                      {item.wallSegments.map((wall) => wall.code).join(' / ')} ·{' '}
                      {item.grade ?? '未定级'}
                    </em>
                  </div>
                </div>
                <Metric
                  label="样本量"
                  value={String(item.sampleSize)}
                  detail={confidenceLabel(item.confidence)}
                />
                <Metric
                  label="反馈者完攀比例"
                  value={percentage(item.respondentCompletionRate)}
                  detail="不是全馆完攀率"
                />
                <Metric
                  label="难度合适"
                  value={percentage(item.difficulty.expectedRate)}
                  detail={`偏简单 ${item.difficulty.easier} · 偏难 ${item.difficulty.harder}`}
                />
                <Metric
                  label="喜欢比例"
                  value={percentage(item.enjoyment.likeRate)}
                  detail={`${item.enjoyment.likes} 份喜欢`}
                />
                <Metric
                  label="安全疑虑"
                  value={String(item.safetyConcernCount)}
                  detail={item.safetyConcernCount ? '需要人工复核' : '暂无反馈'}
                  warning={item.safetyConcernCount > 0}
                />
                <div
                  className={`${styles.recommendation} ${item.recommendation.code === 'SAFETY_REVIEW' ? styles.warning : ''}`}
                >
                  <small>透明规则建议</small>
                  <strong>{item.recommendation.label}</strong>
                </div>
              </article>
            ))}
          </div>
        ) : (
          <div className={styles.emptyState}>
            <strong>还没有可分析的反馈</strong>
            <p>发布线路并张贴二维码后，数据会按线路版本进入这里。</p>
          </div>
        )}
      </SectionCard>
    </div>
  );
}

function Metric({
  label,
  value,
  detail,
  warning = false,
}: {
  label: string;
  value: string;
  detail: string;
  warning?: boolean;
}) {
  return (
    <div className={`${styles.analyticsMetric} ${warning ? styles.warning : ''}`}>
      <small>{label}</small>
      <strong>{value}</strong>
      <em>{detail}</em>
    </div>
  );
}

function percentage(value: number | null) {
  return value === null ? '—' : `${value}%`;
}

function confidenceLabel(value: 'SUFFICIENT' | 'EARLY_SIGNAL' | 'INSUFFICIENT') {
  return value === 'SUFFICIENT'
    ? '样本相对充分'
    : value === 'EARLY_SIGNAL'
      ? '早期信号'
      : '样本不足';
}
