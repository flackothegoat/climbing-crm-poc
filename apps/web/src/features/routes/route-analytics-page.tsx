'use client';

import { useEffect, useState, type ReactNode } from 'react';
import { PageHeading, SectionCard } from '../dashboard/page-components';
import { climbingColorCss, climbingColorLabel } from '../common/climbing-colors';
import {
  getRouteAnalytics,
  type OperationalRoute,
  type RouteAnalytics,
  type RouteAnalyticsItem,
} from './route-operations-api';
import { RoutePhotoPreview } from './route-photo-preview';
import styles from './routes.module.css';

export function RouteAnalyticsPage({
  route,
  onBack,
}: {
  route: OperationalRoute;
  onBack: () => void;
}) {
  const [data, setData] = useState<RouteAnalytics | null>(null);
  const [error, setError] = useState('');

  useEffect(() => {
    setData(null);
    setError('');
    getRouteAnalytics(route.id)
      .then(setData)
      .catch((cause: unknown) =>
        setError(cause instanceof Error ? cause.message : '线路复盘数据加载失败'),
      );
  }, [route.id]);

  return (
    <div className="page-stack">
      <PageHeading
        eyebrow="线路反馈"
        title={`${route.code} · ${route.name}`}
        description="看看这条线路的攀爬结果，以及攀爬者扫码留下的评价。"
        aside={
          <button className={styles.secondaryButton} type="button" onClick={onBack}>
            返回线路档案
          </button>
        }
      />
      {error && <p className="team-feedback is-error">{error}</p>}
      <RouteReviewOverview route={route} />
      {!data ? (
        <SectionCard title="反馈数据" description="正在加载">
          <p className={styles.empty}>正在读取线路数据…</p>
        </SectionCard>
      ) : data.items.length ? (
        <div className={styles.versionReviewList}>
          {data.items.map((item) => (
            <RouteVersionReview item={item} key={item.routeVersionId} />
          ))}
        </div>
      ) : (
        <SectionCard title="反馈数据">
          <div className={styles.emptyState}>
            <strong>暂时没有反馈数据</strong>
            <p>线路发布并投入使用后，这里会显示攀爬结果和扫码评价。</p>
          </div>
        </SectionCard>
      )}
    </div>
  );
}

function RouteReviewOverview({ route }: { route: OperationalRoute }) {
  return (
    <section className={styles.reviewOverview}>
      <div className={styles.reviewPhoto}>
        {route.version?.hasPhoto ? (
          <RoutePhotoPreview route={route} />
        ) : (
          <div className={styles.reviewPhotoEmpty}>
            <span style={{ background: climbingColorCss(route.color) }} />
            <p>暂无线路图片</p>
          </div>
        )}
      </div>
      <div className={styles.reviewOverviewCopy}>
        <small>线路一览</small>
        <h3>{route.name}</h3>
        <p>{route.code}</p>
        <dl>
          <div>
            <dt>难度</dt>
            <dd>{route.grade}</dd>
          </div>
          <div>
            <dt>颜色</dt>
            <dd>{climbingColorLabel(route.color)}</dd>
          </div>
          <div>
            <dt>墙段</dt>
            <dd>{route.wallSegments.map((wall) => wall.code).join(' / ') || '未填写'}</dd>
          </div>
          <div>
            <dt>状态</dt>
            <dd>{routeStatusLabel(route.status)}</dd>
          </div>
        </dl>
      </div>
    </section>
  );
}

function RouteVersionReview({ item }: { item: RouteAnalyticsItem }) {
  return (
    <SectionCard
      title={`第 ${item.versionNumber} 版`}
      description={`难度 ${item.grade ?? '未填写'} · ${item.wallSegments.map((wall) => wall.code).join(' / ') || '未填写墙段'}`}
    >
      <div className={styles.analyticsSources}>
        <AnalyticsSource
          title="摄像头记录"
          source="自动记录的攀爬结果"
          badge="摄像头"
          empty={item.algorithm.sampleSize === 0}
          emptyText="还没有识别到这条线路的攀爬记录。"
        >
          <ReviewMetric
            label="总次数"
            value={String(item.algorithm.sampleSize)}
            detail="已记录的攀爬"
          />
          <ReviewMetric label="完攀" value={String(item.algorithm.completed)} detail="到达终点" />
          <ReviewMetric label="未完攀" value={String(item.algorithm.failed)} detail="未到达终点" />
          <ReviewMetric
            label="完攀率"
            value={percentage(item.algorithm.completionRate)}
            detail="完攀次数占比"
          />
          <ReviewMetric
            label="待确认"
            value={String(item.algorithm.abandoned + item.algorithm.unknown)}
            detail="结果暂不明确"
          />
        </AnalyticsSource>

        <AnalyticsSource
          title="扫码反馈"
          source="攀爬者扫码留下的评价"
          badge="扫码"
          empty={item.sampleSize === 0}
          emptyText="还没有人提交扫码反馈。"
        >
          <ReviewMetric
            label="反馈样本"
            value={String(item.sampleSize)}
            detail={confidenceLabel(item.confidence)}
          />
          <ReviewMetric
            label="反馈完攀率"
            value={percentage(item.respondentCompletionRate)}
            detail="提交反馈的人"
          />
          <ReviewMetric
            label="难度合适"
            value={percentage(item.difficulty.expectedRate)}
            detail={`偏简单 ${item.difficulty.easier} · 偏难 ${item.difficulty.harder}`}
          />
          <ReviewMetric
            label="喜欢比例"
            value={percentage(item.enjoyment.likeRate)}
            detail={`${item.enjoyment.likes} 人喜欢`}
          />
          <ReviewMetric
            label="安全疑虑"
            value={String(item.safetyConcernCount)}
            detail={item.safetyConcernCount ? '请尽快查看' : '没有人提出'}
            warning={item.safetyConcernCount > 0}
          />
          <div
            className={`${styles.sourceRecommendation} ${item.recommendation.code === 'SAFETY_REVIEW' ? styles.warning : ''}`}
          >
            <small>当前建议</small>
            <strong>{item.recommendation.label}</strong>
          </div>
        </AnalyticsSource>
      </div>
    </SectionCard>
  );
}

function AnalyticsSource({
  title,
  source,
  badge,
  empty,
  emptyText,
  children,
}: {
  title: string;
  source: string;
  badge: string;
  empty: boolean;
  emptyText: string;
  children: ReactNode;
}) {
  return (
    <section className={styles.analyticsSource}>
      <header>
        <div>
          <h4>{title}</h4>
          <p>{source}</p>
        </div>
        <span>{badge}</span>
      </header>
      {empty ? <p className={styles.sourceEmpty}>{emptyText}</p> : null}
      <div className={styles.sourceMetrics}>{children}</div>
    </section>
  );
}

function ReviewMetric({
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
    <div className={`${styles.reviewMetric} ${warning ? styles.warning : ''}`}>
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

function routeStatusLabel(value: OperationalRoute['status']) {
  return value === 'PUBLISHED' ? '正常线路' : value === 'INACTIVE' ? '已停用线路' : value;
}
