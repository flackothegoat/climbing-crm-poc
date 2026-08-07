'use client';

import { useEffect, useRef, useState } from 'react';
import { createSeedRouteSettingPlan } from '../route-setting/route-setting-demo-data';
import type { ClimbingRoute } from '../route-setting/route-setting.types';
import { PageHeading } from '../dashboard/page-components';
import {
  buildMonthlyPerformance,
  summarizeAllRoutes,
  summarizeRoutePerformance,
} from './wall-analytics';
import { PERFORMANCE_MONTHS } from './wall-dummy-observations';
import {
  createManualClimbObservation,
  ensureW06DemoData,
  getClimbObservations,
  getRouteSettingPlan,
} from './wall-persistence-api';
import { WallOverviewScene, type WallOverviewSceneHandle } from './wall-overview-scene';
import { WallPlanMap } from './wall-plan-map';
import { WallRouteMap } from './wall-route-map';
import { findWallSurveySegment, TIANYU_1F_AREA, WALL_SURVEY_SEGMENTS } from './wall-survey-data';
import type {
  ClimbObservation,
  ClimbObservationOutcome,
  MonthlyPerformanceSummary,
  RoutePerformanceSummary,
  WallCode,
} from './wall.types';
import styles from './walls.module.css';

export function WallExplorerPage() {
  const [routePlan, setRoutePlan] = useState(() =>
    createSeedRouteSettingPlan('2026-07-30T00:00:00+08:00'),
  );
  const [selectedWallCode, setSelectedWallCode] = useState<WallCode>('W06');
  const [selectedRouteId, setSelectedRouteId] = useState<string | null>('route-green');
  const [observations, setObservations] = useState<ClimbObservation[]>([]);
  const [message, setMessage] = useState('正在从数据库读取线路和攀爬事件…');
  const sceneRef = useRef<WallOverviewSceneHandle>(null);
  const segment = findWallSurveySegment(selectedWallCode);
  const isDetailedWall = selectedWallCode === 'W06';

  useEffect(() => {
    let active = true;
    async function loadPersistentData() {
      try {
        await ensureW06DemoData();
        const [persistedPlan, persistedObservations] = await Promise.all([
          getRouteSettingPlan('W06'),
          getClimbObservations('W06'),
        ]);
        if (!active) return;
        setRoutePlan(persistedPlan);
        setObservations(persistedObservations);
        setSelectedRouteId((current) =>
          persistedPlan.routes.some((route) => route.id === current)
            ? current
            : (persistedPlan.routes[0]?.id ?? null),
        );
        setMessage('已载入数据库事件；人工补记将在刷新后保留。');
      } catch (error) {
        if (!active) return;
        setMessage(error instanceof Error ? error.message : '墙面持久化数据加载失败');
      }
    }
    void loadPersistentData();
    return () => {
      active = false;
    };
  }, []);

  function selectWall(code: WallCode): void {
    setSelectedWallCode(code);
    setSelectedRouteId((current) => (code === 'W06' ? (current ?? routePlan.routes[0].id) : null));
    setMessage(
      code === 'W06'
        ? 'W06 已具备线路和孔位演示数据。'
        : `${code} 当前只有测绘宽度和估测墙高，尚未完成现场孔位校准。`,
    );
  }

  async function addManualObservation(outcome: ClimbObservationOutcome): Promise<void> {
    const routeId = selectedRouteId ?? routePlan.routes[0].id;
    const now = new Date();
    const route = routePlan.routes.find((item) => item.id === routeId);
    try {
      const observation = await createManualClimbObservation({
        climberKey: `manual-${now.getTime()}`,
        observedAt: now.toISOString(),
        outcome,
        requestKey: globalThis.crypto.randomUUID(),
        routeId,
        wallCode: 'W06',
      });
      setObservations((items) => [...items, observation]);
      setMessage(
        `已持久化“${route?.name}”的一次${outcome === 'COMPLETED' ? '完攀' : '失败尝试'}。`,
      );
    } catch (error) {
      setMessage(error instanceof Error ? error.message : '人工攀爬事件保存失败');
    }
  }

  return (
    <div className="page-stack">
      <PageHeading
        aside={<DataSourceBadge />}
        description="从整馆空间定位到单个测绘墙段，查看墙面参数、当前线路与攀爬表现。"
        eyebrow="核心模块 · 空间与运营"
        title="墙面数字总览"
      />

      <AreaMetrics />

      <section className={styles.overviewLayout}>
        <article className={styles.overviewCard}>
          <div className={styles.cardHeader}>
            <div>
              <span className={styles.kicker}>区域模型</span>
              <h3>{TIANYU_1F_AREA.name}</h3>
              <p>扫描模型为整体单网格，彩色覆盖层表示 W01–W15 测绘折线分段。</p>
            </div>
            <div className={styles.sceneActions}>
              <button onClick={() => sceneRef.current?.resetCamera()} type="button">
                整体视角
              </button>
              <button onClick={() => sceneRef.current?.showTopView()} type="button">
                俯视定位
              </button>
              <button
                className={styles.primaryButton}
                onClick={() => sceneRef.current?.focusSelected()}
                type="button"
              >
                聚焦 {selectedWallCode}
              </button>
            </div>
          </div>
          <div className={styles.sceneFrame}>
            <WallOverviewScene
              ref={sceneRef}
              onSelectWall={selectWall}
              selectedWallCode={selectedWallCode}
            />
            <div className={styles.sceneLegend}>
              <span>
                <i className={styles.legendSelected} />
                当前墙段
              </span>
              <span>
                <i className={styles.legendSurvey} />
                测绘分段
              </span>
              <span>拖动旋转 · 滚轮缩放 · 点击选择</span>
            </div>
          </div>
        </article>

        <aside className={styles.locationPanel}>
          <div className={styles.cardHeaderCompact}>
            <div>
              <span className={styles.kicker}>平面定位</span>
              <h3>15 个测绘墙段</h3>
            </div>
            <span className={styles.countBadge}>{selectedWallCode}</span>
          </div>
          <WallPlanMap onSelectWall={selectWall} selectedWallCode={selectedWallCode} />
          <div className={styles.segmentPicker} aria-label="墙段快速选择">
            {WALL_SURVEY_SEGMENTS.map((item) => (
              <button
                className={item.code === selectedWallCode ? styles.segmentButtonActive : ''}
                key={item.code}
                onClick={() => selectWall(item.code)}
                type="button"
              >
                {item.code}
              </button>
            ))}
          </div>
          <WallFacts code={selectedWallCode} />
        </aside>
      </section>

      <section className={styles.detailSection}>
        <div className={styles.cardHeader}>
          <div>
            <span className={styles.kicker}>墙段详情</span>
            <h3>{segment.name}</h3>
            <p>
              {isDetailedWall
                ? 'W06 已接入孔位草案、定线结果和演示攀爬事件。'
                : '该墙段已完成空间定位，详细倾角、孔位和线路资料等待现场录入。'}
            </p>
          </div>
          <span className={isDetailedWall ? styles.detailReadyBadge : styles.detailPendingBadge}>
            {isDetailedWall ? '演示数据完整' : '待现场采集'}
          </span>
        </div>

        {isDetailedWall ? (
          <W06Detail
            addManualObservation={addManualObservation}
            message={message}
            observations={observations}
            routes={routePlan.routes}
            routePlan={routePlan}
            selectedRouteId={selectedRouteId}
            setSelectedRouteId={setSelectedRouteId}
          />
        ) : (
          <PendingWallDetail code={selectedWallCode} />
        )}
      </section>

      <section className={styles.engineeringBoundary}>
        <strong>数据边界</strong>
        <p>
          W01–W15 是扫描截线的几何简化分段，并非真实墙板拼缝；当前宽度、墙高、W06
          倾角和孔距均属于扫描估测。攀爬统计由数据库中的 Dummy
          与人工事件生成，不代表摄像头实测结果。
        </p>
      </section>
    </div>
  );
}

function DataSourceBadge() {
  return (
    <div className={styles.sourceBadge}>
      <span>数据库事件 + 扫描估测</span>
      <small>含 DUMMY 种子 · 非摄像头实测</small>
    </div>
  );
}

function AreaMetrics() {
  return (
    <section className={styles.areaMetrics} aria-label="场馆空间指标">
      <Metric label="区域" value="天宇一楼" detail="整体扫描模型" />
      <Metric label="测绘墙段" value="15" detail="W01–W15" />
      <Metric label="展开总宽" value="45.461 m" detail="Y=2.00 m 截线" />
      <Metric label="可靠墙高" value="约 4.10 m" detail="扫描点云统计" />
    </section>
  );
}

function Metric(props: { detail: string; label: string; value: string }) {
  return (
    <article className={styles.metric}>
      <span>{props.label}</span>
      <strong>{props.value}</strong>
      <small>{props.detail}</small>
    </article>
  );
}

function WallFacts(props: { code: WallCode }) {
  const segment = findWallSurveySegment(props.code);
  return (
    <dl className={styles.wallFacts}>
      <div>
        <dt>展开宽度</dt>
        <dd>{formatMm(segment.widthMm)}</dd>
      </div>
      <div>
        <dt>墙高</dt>
        <dd>约 {formatMm(segment.heightMm)}</dd>
      </div>
      <div>
        <dt>倾离竖直</dt>
        <dd>{props.code === 'W06' ? '约 10.3°' : '待复核'}</dd>
      </div>
      <div>
        <dt>孔位中心距</dt>
        <dd>{props.code === 'W06' ? '约 200 × 200 mm' : '待校准'}</dd>
      </div>
      <div>
        <dt>有效线路</dt>
        <dd>{segment.routeCount || '尚未录入'}</dd>
      </div>
      <div>
        <dt>数据状态</dt>
        <dd className={styles.estimateText}>扫描估测</dd>
      </div>
    </dl>
  );
}

function W06Detail(props: {
  addManualObservation: (outcome: ClimbObservationOutcome) => void;
  message: string;
  observations: ClimbObservation[];
  routePlan: ReturnType<typeof createSeedRouteSettingPlan>;
  routes: ClimbingRoute[];
  selectedRouteId: string | null;
  setSelectedRouteId: (routeId: string | null) => void;
}) {
  const summary = props.selectedRouteId
    ? summarizeRoutePerformance(props.observations, props.selectedRouteId)
    : summarizeAllRoutes(props.observations);
  const monthly = monthlyTrend(props.observations, props.selectedRouteId);

  return (
    <div className={styles.w06DetailGrid}>
      <article className={styles.routeVisualizationCard}>
        <div className={styles.subsectionHeader}>
          <div>
            <h4>当前线路正立面</h4>
            <p>起点和终点来自定线数据中的显式角色，不依赖高度推断。</p>
          </div>
          <span>约 200 mm 孔距</span>
        </div>
        <div className={styles.routeFilters}>
          <button
            className={props.selectedRouteId === null ? styles.routeFilterActive : ''}
            onClick={() => props.setSelectedRouteId(null)}
            type="button"
          >
            全部线路
          </button>
          {props.routes.map((route) => (
            <button
              className={props.selectedRouteId === route.id ? styles.routeFilterActive : ''}
              key={route.id}
              onClick={() => props.setSelectedRouteId(route.id)}
              type="button"
            >
              <i className={styles[route.color]} />
              {route.name} · {route.grade}
            </button>
          ))}
        </div>
        <WallRouteMap plan={props.routePlan} selectedRouteId={props.selectedRouteId} />
      </article>

      <article className={styles.analyticsCard}>
        <div className={styles.subsectionHeader}>
          <div>
            <h4>攀爬表现</h4>
            <p>2026 年 2–7 月，按有效尝试事件实时计算。</p>
          </div>
          <span className={styles.dummyBadge}>DUMMY</span>
        </div>
        <PerformanceMetrics summary={summary} />
        <MonthlyTrendChart monthly={monthly} />
        <div className={styles.manualCapture}>
          <div>
            <strong>手工记录演示</strong>
            <small>
              {props.selectedRouteId
                ? '追加到当前选中线路，并持久化到数据库。'
                : '请先选择一条线路。'}
            </small>
          </div>
          <div>
            <button
              disabled={!props.selectedRouteId}
              onClick={() => props.addManualObservation('FAILED')}
              type="button"
            >
              记录失败
            </button>
            <button
              className={styles.primaryButton}
              disabled={!props.selectedRouteId}
              onClick={() => props.addManualObservation('COMPLETED')}
              type="button"
            >
              记录完攀
            </button>
          </div>
        </div>
        <p className={styles.inlineStatus} role="status">
          {props.message}
        </p>
      </article>

      <RouteComparison
        observations={props.observations}
        routes={props.routes}
        selectedRouteId={props.selectedRouteId}
        onSelectRoute={props.setSelectedRouteId}
      />
    </div>
  );
}

function PerformanceMetrics(props: { summary: RoutePerformanceSummary }) {
  return (
    <div className={styles.performanceMetrics}>
      <MetricSmall label="攀爬人次" value={String(props.summary.attempts)} />
      <MetricSmall label="完攀次数" value={String(props.summary.completed)} />
      <MetricSmall label="完攀率" value={`${props.summary.completionRate}%`} />
      <MetricSmall label="演示访客" value={String(props.summary.uniqueClimbers)} />
    </div>
  );
}

function MetricSmall(props: { label: string; value: string }) {
  return (
    <div>
      <span>{props.label}</span>
      <strong>{props.value}</strong>
    </div>
  );
}

function MonthlyTrendChart(props: { monthly: MonthlyPerformanceSummary[] }) {
  const maxAttempts = Math.max(...props.monthly.map((item) => item.attempts), 1);
  return (
    <div className={styles.chartBlock}>
      <div className={styles.chartTitle}>
        <strong>月度趋势</strong>
        <span>总柱：尝试 · 深色：完攀</span>
      </div>
      <div className={styles.monthlyChart}>
        {props.monthly.map((item) => (
          <div className={styles.monthColumn} key={item.month}>
            <div className={styles.barValue}>{item.attempts}</div>
            <div
              className={styles.barTrack}
              style={{ height: `${Math.max(18, (item.attempts / maxAttempts) * 132)}px` }}
            >
              <div className={styles.barCompleted} style={{ height: `${item.completionRate}%` }} />
            </div>
            <strong>{Number(item.month.slice(5))}月</strong>
            <small>{item.completionRate}%</small>
          </div>
        ))}
      </div>
    </div>
  );
}

function RouteComparison(props: {
  observations: ClimbObservation[];
  onSelectRoute: (routeId: string) => void;
  routes: ClimbingRoute[];
  selectedRouteId: string | null;
}) {
  return (
    <article className={styles.routeComparison}>
      <div className={styles.subsectionHeader}>
        <div>
          <h4>线路对比</h4>
          <p>颜色只用于识别，数据始终按 routeId 聚合。</p>
        </div>
      </div>
      <div className={styles.routeComparisonGrid}>
        {props.routes.map((route) => {
          const summary = summarizeRoutePerformance(props.observations, route.id);
          return (
            <button
              className={props.selectedRouteId === route.id ? styles.routeCompareActive : ''}
              key={route.id}
              onClick={() => props.onSelectRoute(route.id)}
              type="button"
            >
              <span>
                <i className={styles[route.color]} />
                <strong>{route.name}</strong>
                <small>{route.grade}</small>
              </span>
              <b>{summary.completionRate}%</b>
              <em>
                {summary.attempts} 次尝试 · {summary.completed} 次完攀
              </em>
            </button>
          );
        })}
      </div>
    </article>
  );
}

function PendingWallDetail(props: { code: WallCode }) {
  const segment = findWallSurveySegment(props.code);
  return (
    <div className={styles.pendingDetail}>
      <div className={styles.pendingDiagram}>
        <span>{props.code}</span>
        <i style={{ aspectRatio: `${Math.max(segment.widthMm, 1)} / ${segment.heightMm}` }} />
      </div>
      <div>
        <h4>空间轮廓已经可以使用</h4>
        <p>当前可以在整体扫描模型中定位并聚焦该墙段，但不能可靠展示孔位、倾角和线路。</p>
        <ul>
          <li>已知：展开宽度约 {formatMm(segment.widthMm)}</li>
          <li>估测：可靠墙高约 {formatMm(segment.heightMm)}</li>
          <li>待补：墙面倾角、真实孔列/孔行、缺失孔和现状线路</li>
        </ul>
      </div>
    </div>
  );
}

function monthlyTrend(
  observations: ClimbObservation[],
  selectedRouteId: string | null,
): MonthlyPerformanceSummary[] {
  if (selectedRouteId) {
    return buildMonthlyPerformance(observations, [selectedRouteId], PERFORMANCE_MONTHS);
  }
  return PERFORMANCE_MONTHS.map((month) => ({
    ...summarizeAllRoutes(observations.filter((item) => item.observedAt.startsWith(month))),
    month,
  }));
}

function formatMm(value: number): string {
  return value >= 1_000
    ? `${(value / 1_000).toFixed(3).replace(/0+$/, '').replace(/\.$/, '')} m`
    : `${value} mm`;
}
