'use client';

import { useEffect, useState, type ReactNode } from 'react';
import { PageHeading, SectionCard } from '../dashboard/page-components';
import { climbingColorCss } from '../common/climbing-colors';
import {
  getRouteAnalytics,
  type OperationalRoute,
  type RouteAnalytics,
  type RouteAnalyticsItem,
} from './route-operations-api';
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
        eyebrow="线路档案 · 反馈与复盘"
        title={`${route.code} · ${route.name}`}
        description="按线路版本核对 Worker 算法识别与攀爬者扫码反馈，两类数据独立统计。"
        aside={
          <button className={styles.secondaryButton} type="button" onClick={onBack}>
            返回线路档案
          </button>
        }
      />
      {error && <p className="team-feedback is-error">{error}</p>}
      <div className={styles.sourceNotices}>
        <DataNotice label="算法识别口径">
          {data?.scope.algorithmNotice ?? '正在读取 Worker 识别数据口径…'}
        </DataNotice>
        <DataNotice label="扫码反馈口径">
          {data?.scope.metricNotice ?? '正在读取扫码反馈数据口径…'}
        </DataNotice>
      </div>
      {!data ? (
        <SectionCard title="线路数据" description="正在从业务数据库读取真实记录。">
          <p className={styles.empty}>正在聚合线路复盘数据…</p>
        </SectionCard>
      ) : data.items.length ? (
        <div className={styles.versionReviewList}>
          {data.items.map((item) => (
            <RouteVersionReview item={item} key={item.routeVersionId} />
          ))}
        </div>
      ) : (
        <SectionCard title="线路数据" description="草稿版本不会进入识别或反馈统计。">
          <div className={styles.emptyState}>
            <strong>这条线路还没有可复盘的发布版本</strong>
            <p>线路发布后，Worker 识别与二维码反馈会按版本分别归档。</p>
          </div>
        </SectionCard>
      )}
    </div>
  );
}

function RouteVersionReview({ item }: { item: RouteAnalyticsItem }) {
  return (
    <SectionCard
      title={`V${item.versionNumber} · ${item.grade ?? '未定级'}`}
      description={`${item.wallSegments.map((wall) => wall.code).join(' / ') || '未关联墙段'} · ${routeStatusLabel(item.routeStatus)}`}
    >
      <div className={styles.versionIdentity}>
        <span style={{ background: item.color ? climbingColorCss(item.color) : '#8da097' }} />
        <p>
          以下数据只属于 {item.routeCode} 的 V{item.versionNumber}，不会与其他线路合并。
        </p>
      </div>
      <div className={styles.analyticsSources}>
        <AnalyticsSource
          title="算法识别"
          source="视觉 Worker 真实记录"
          empty={item.algorithm.sampleSize === 0}
          emptyText="暂无 Worker 识别记录。线路产生正式识别结果后，这里才会出现数据。"
        >
          <ReviewMetric
            label="识别记录"
            value={String(item.algorithm.sampleSize)}
            detail="该线路版本"
          />
          <ReviewMetric
            label="成功次数"
            value={String(item.algorithm.completed)}
            detail="原始判定为完攀"
          />
          <ReviewMetric
            label="失败次数"
            value={String(item.algorithm.failed)}
            detail="原始判定为失败"
          />
          <ReviewMetric
            label="算法完攀率"
            value={percentage(item.algorithm.completionRate)}
            detail="成功 ÷（成功 + 失败）"
          />
          <ReviewMetric
            label="其他结果"
            value={String(item.algorithm.abandoned + item.algorithm.unknown)}
            detail={`放弃 ${item.algorithm.abandoned} · 不确定 ${item.algorithm.unknown}`}
          />
        </AnalyticsSource>

        <AnalyticsSource
          title="扫码反馈"
          source="攀爬者主动提交的真实反馈"
          empty={item.sampleSize === 0}
          emptyText="暂无扫码反馈。此处不会用模拟样本填充。"
        >
          <ReviewMetric
            label="反馈样本"
            value={String(item.sampleSize)}
            detail={confidenceLabel(item.confidence)}
          />
          <ReviewMetric
            label="反馈者完攀率"
            value={percentage(item.respondentCompletionRate)}
            detail="仅代表主动反馈者"
          />
          <ReviewMetric
            label="难度合适"
            value={percentage(item.difficulty.expectedRate)}
            detail={`偏简单 ${item.difficulty.easier} · 偏难 ${item.difficulty.harder}`}
          />
          <ReviewMetric
            label="喜欢比例"
            value={percentage(item.enjoyment.likeRate)}
            detail={`${item.enjoyment.likes} 份喜欢`}
          />
          <ReviewMetric
            label="安全疑虑"
            value={String(item.safetyConcernCount)}
            detail={item.safetyConcernCount ? '需要人工优先复核' : '暂无反馈'}
            warning={item.safetyConcernCount > 0}
          />
          <div
            className={`${styles.sourceRecommendation} ${item.recommendation.code === 'SAFETY_REVIEW' ? styles.warning : ''}`}
          >
            <small>透明规则建议</small>
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
  empty,
  emptyText,
  children,
}: {
  title: string;
  source: string;
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
        <span>{empty ? '暂无数据' : '真实数据'}</span>
      </header>
      {empty ? <p className={styles.sourceEmpty}>{emptyText}</p> : null}
      <div className={styles.sourceMetrics}>{children}</div>
    </section>
  );
}

function DataNotice({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className={styles.metricNotice}>
      <strong>{label}</strong>
      <p>{children}</p>
    </div>
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
