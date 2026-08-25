'use client';

import Image from 'next/image';
import { useEffect, useMemo, useRef, useState } from 'react';
import { PageHeading } from '../dashboard/page-components';
import { climbingColorCss } from '../common/climbing-colors';
import { W06_HOLES } from '../walls/w06-wall-data';
import {
  cancelWallSettingJob,
  completeWallSettingJob,
  createOrGetWallSettingJob,
  ensureW06RouteSettingWorkspace,
  getRouteSettingPlan,
  getRouteSettingAssets,
  lockWallSettingJob,
  saveRouteSettingPlan,
} from '../walls/wall-persistence-api';
import { createEmptyRouteSettingPlan } from './route-setting-demo-data';
import {
  addPlacement,
  downloadTextFile,
  exportPlacementCsv,
  exportRouteSettingPlanJson,
  findPlacementCollisions,
  findWallHole,
  matchPlacementMount,
  movePlacement,
  placementHasMountConflict,
  removePlacement,
  removeRoutePlacements,
  rotatePlacement,
} from './route-setting-domain';
import { RouteSettingScene, type RouteSettingSceneHandle } from './route-setting-scene';
import type {
  HoldAssetDefinition,
  RouteSettingPlan,
  RouteSettingView,
  WallSettingJob,
} from './route-setting.types';
import styles from './route-setting.module.css';

export function RouteSettingStudio() {
  const [plan, setPlan] = useState<RouteSettingPlan>(() => createEmptyRouteSettingPlan());
  const [assets, setAssets] = useState<HoldAssetDefinition[]>([]);
  const [job, setJob] = useState<WallSettingJob | null>(null);
  const [history, setHistory] = useState<RouteSettingPlan[]>([]);
  const [hydrated, setHydrated] = useState(false);
  const [message, setMessage] = useState('拖动岩点即可吸附到最近孔位。');
  const [selectedPlacementId, setSelectedPlacementId] = useState<string | null>(null);
  const [selectedRouteId, setSelectedRouteId] = useState<string | null>(null);
  const [view, setView] = useState<RouteSettingView>('perspective');
  const sceneRef = useRef<RouteSettingSceneHandle>(null);
  const lastSavedPlanRef = useRef('');
  const latestRevisionRef = useRef(0);
  const saveQueueRef = useRef<Promise<void>>(Promise.resolve());
  const [actionBusy, setActionBusy] = useState(false);
  const collisions = useMemo(() => findPlacementCollisions(plan, assets), [assets, plan]);
  const selectedPlacement = plan.placements.find((item) => item.id === selectedPlacementId) ?? null;

  useEffect(() => {
    let active = true;
    async function loadPersistedPlan() {
      setMessage('正在从数据库读取 W06 定线计划…');
      try {
        await ensureW06RouteSettingWorkspace();
        const currentJob = await createOrGetWallSettingJob('W06');
        const [persistedPlan, assetPage] = await Promise.all([
          getRouteSettingPlan('W06', currentJob.id),
          getRouteSettingAssets(),
        ]);
        if (!active) return;
        setJob(currentJob);
        setAssets(assetPage.items);
        lastSavedPlanRef.current = planFingerprint(persistedPlan);
        latestRevisionRef.current = persistedPlan.revision;
        setPlan(persistedPlan);
        setHydrated(true);
        setMessage('已载入空白定线草稿；草稿保存不会改动正式库存。');
      } catch (error) {
        if (!active) return;
        setMessage(error instanceof Error ? error.message : '数据库定线计划加载失败');
      }
    }
    void loadPersistedPlan();
    return () => {
      active = false;
    };
  }, []);

  useEffect(() => {
    if (!hydrated) return;
    const fingerprint = planFingerprint(plan);
    if (fingerprint === lastSavedPlanRef.current) return;
    const timeout = window.setTimeout(() => {
      void persistPlan(plan);
    }, 700);
    return () => window.clearTimeout(timeout);
  }, [hydrated, plan]);

  function persistPlan(candidate: RouteSettingPlan): Promise<void> {
    const operation = saveQueueRef.current
      .catch(() => undefined)
      .then(async () => {
        if (planFingerprint(candidate) === lastSavedPlanRef.current) return;
        const submitted = { ...candidate, revision: latestRevisionRef.current };
        const saved = await saveRouteSettingPlan(submitted);
        latestRevisionRef.current = saved.revision;
        lastSavedPlanRef.current = planFingerprint(candidate);
        setPlan((current) =>
          planFingerprint(current) === planFingerprint(candidate)
            ? saved
            : { ...current, revision: saved.revision },
        );
        setMessage('定线草稿已保存，尚未占用正式库存。');
      });
    saveQueueRef.current = operation;
    operation.catch((error: unknown) =>
      setMessage(error instanceof Error ? error.message : '定线草稿保存失败'),
    );
    return operation;
  }

  function commit(next: RouteSettingPlan, successMessage: string): void {
    setHistory((items) => [...items.slice(-19), plan]);
    setPlan(next);
    setMessage(successMessage);
  }

  function handleMovePlacement(placementId: string, holeId: string): void {
    if (job?.status !== 'DRAFT') return setMessage('已锁定方案不能移动岩点。');
    const next = movePlacement(plan, placementId, holeId);
    if (placementHasMountConflict(next, placementId, assets)) {
      return setMessage(`${holeId} 无法满足安装孔型，或所需孔位已被占用。`);
    }
    commit(next, `已吸附到 ${holeId}，安装孔型匹配。`);
  }

  function handleRotate(deltaDegrees: number): void {
    if (job?.status !== 'DRAFT') return setMessage('已锁定方案不能旋转岩点。');
    if (!selectedPlacement) return;
    const next = rotatePlacement(plan, selectedPlacement.id, deltaDegrees);
    if (placementHasMountConflict(next, selectedPlacement.id, assets)) {
      return setMessage('该角度无法让全部安装孔匹配当前墙面网格。');
    }
    commit(next, `岩点已旋转 ${deltaDegrees > 0 ? '+' : ''}${deltaDegrees}°。`);
  }

  function handleUnmountRoute(routeId: string): void {
    if (job?.status !== 'DRAFT') return setMessage('已锁定方案不能从草稿移除线路。');
    const route = plan.routes.find((item) => item.id === routeId);
    const count = plan.placements.filter((item) => item.routeId === routeId).length;
    if (!count) return setMessage(`${route?.name ?? '该线路'}当前没有已安装岩点。`);
    const withoutPlacements = removeRoutePlacements(plan, routeId);
    commit(
      {
        ...withoutPlacements,
        routes: withoutPlacements.routes.filter((item) => item.id !== routeId),
      },
      `已拆卸“${route?.name}”的 ${count} 个岩点，可撤销。`,
    );
    setSelectedPlacementId(null);
    if (selectedRouteId === routeId) setSelectedRouteId(null);
  }

  function handleDeletePlacement(): void {
    if (job?.status !== 'DRAFT') return setMessage('已锁定方案不能从草稿移除岩点。');
    if (!selectedPlacement) return;
    const withoutPlacement = removePlacement(plan, selectedPlacement.id);
    const routeStillUsed = withoutPlacement.placements.some(
      (item) => item.routeId === selectedPlacement.routeId,
    );
    commit(
      routeStillUsed
        ? withoutPlacement
        : {
            ...withoutPlacement,
            routes: withoutPlacement.routes.filter((item) => item.id !== selectedPlacement.routeId),
          },
      `已拆卸 ${selectedPlacement.holeId} 的岩点。`,
    );
    setSelectedPlacementId(null);
    if (!routeStillUsed && selectedRouteId === selectedPlacement.routeId) setSelectedRouteId(null);
  }

  function handleUndo(): void {
    if (job?.status !== 'DRAFT') return setMessage('已锁定方案不能撤销。');
    const previous = history.at(-1);
    if (!previous) return;
    setPlan(previous);
    setHistory((items) => items.slice(0, -1));
    setSelectedPlacementId(null);
    setMessage('已撤销上一步操作。');
  }

  function handleDrop(event: React.DragEvent<HTMLDivElement>): void {
    event.preventDefault();
    if (job?.status !== 'DRAFT') return setMessage('只有草稿任务可以添加岩点。');
    const assetId = event.dataTransfer.getData('application/x-climbing-hold');
    const asset = assets.find((item) => item.assetId === assetId);
    const holeId = sceneRef.current?.pickHoleAtClient(event.clientX, event.clientY);
    if (!asset || !holeId) return setMessage('请把岩点放在墙面范围内。');
    if (draftRemaining(asset, plan) < 1) return setMessage(`${asset.label}的仓库可用数量不足。`);
    if (plan.placements.some((placement) => placement.holeId === holeId)) {
      return setMessage(`${holeId} 已被占用，请选择相邻孔位。`);
    }
    const routeId = selectedRouteId ?? `route-${crypto.randomUUID()}`;
    const sourcePlan = selectedRouteId
      ? plan
      : {
          ...plan,
          routes: [
            ...plan.routes,
            {
              id: routeId,
              name: `新线路 ${plan.routes.length + 1}`,
              color: asset.color,
              grade: '未定级',
            },
          ],
        };
    const next = addPlacement(sourcePlan, {
      assetId: asset.assetId,
      routeId,
      holeId,
      role: 'NORMAL',
      rotationDegrees: 0,
    });
    const added = next.placements.at(-1);
    if (!added || placementHasMountConflict(next, added.id, assets)) {
      return setMessage(`${asset.label}的安装孔型无法匹配该位置。`);
    }
    if (!selectedRouteId) setSelectedRouteId(routeId);
    commit(next, `${asset.label}已安装到 ${holeId}，安装孔型匹配。`);
  }

  function handleReset(): void {
    commit(
      {
        ...createEmptyRouteSettingPlan(),
        settingJobId: plan.settingJobId,
        settingJob: plan.settingJob,
        revision: plan.revision,
      },
      '已清空当前定线草稿。',
    );
    setSelectedPlacementId(null);
    setSelectedRouteId(null);
  }

  async function handleJobAction(action: 'lock' | 'cancel' | 'complete') {
    if (!job) return;
    setActionBusy(true);
    try {
      await saveQueueRef.current;
      if (job.status === 'DRAFT') await persistPlan(plan);
      const requestKey = crypto.randomUUID();
      const updated =
        action === 'lock'
          ? await lockWallSettingJob(job.id, requestKey)
          : action === 'cancel'
            ? await cancelWallSettingJob(job.id, requestKey)
            : await completeWallSettingJob(job.id, requestKey);
      setJob(updated);
      setPlan((current) => ({
        ...current,
        settingJob: { id: updated.id, name: updated.name, status: updated.status },
      }));
      const assetPage = await getRouteSettingAssets();
      setAssets(assetPage.items);
      setMessage(
        action === 'lock'
          ? '方案已锁定，所需岩点已从仓库转为预留。'
          : action === 'cancel'
            ? '定线任务已取消，预留库存已全部释放。'
            : '现场安装已确认，库存已转为已上墙。',
      );
    } catch (error) {
      setMessage(error instanceof Error ? error.message : '定线任务操作失败');
    } finally {
      setActionBusy(false);
    }
  }

  return (
    <div className="page-stack">
      <PageHeading
        eyebrow="核心模块 · 定线 MVP"
        title="W06 数字定线实验台"
        description="在单个代表墙段上验证数字墙面、孔位吸附、岩点布置、线路拆卸与交付导出。"
        aside={<CalibrationBadge />}
      />

      <section className={styles.metrics} aria-label="W06 指标">
        <Metric label="墙段" value="W06" detail="展开宽 5.592 m" />
        <Metric label="孔位草案" value={String(W06_HOLES.length)} detail="28 列 × 21 行" />
        <Metric
          label="方案岩点"
          value={String(plan.placements.length)}
          detail={
            job?.status === 'DRAFT'
              ? '草稿内占用，未改库存'
              : `任务状态：${job?.status ?? '加载中'}`
          }
        />
        <Metric
          label="碰撞提示"
          value={String(collisions.length)}
          detail={collisions.length ? '请调整相邻岩点' : '当前无冲突'}
          warning={Boolean(collisions.length)}
        />
      </section>

      <section className={styles.workspace}>
        <div className={styles.stageCard}>
          <RouteSettingToolbar
            actionBusy={actionBusy}
            canFocus={Boolean(selectedPlacement)}
            historyCount={history.length}
            jobStatus={job?.status ?? null}
            placementCount={plan.placements.length}
            onCancel={() => void handleJobAction('cancel')}
            onComplete={() => void handleJobAction('complete')}
            onFocus={() => sceneRef.current?.focusSelected()}
            onLock={() => void handleJobAction('lock')}
            onReset={handleReset}
            onResetView={() => sceneRef.current?.resetCamera()}
            onUndo={handleUndo}
            onViewChange={setView}
            view={view}
          />
          <div
            className={styles.sceneDropZone}
            onDragOver={(event) => event.preventDefault()}
            onDrop={handleDrop}
          >
            <RouteSettingScene
              ref={sceneRef}
              assets={assets}
              onDeleteSelected={handleDeletePlacement}
              plan={plan}
              selectedPlacementId={selectedPlacementId}
              selectedRouteId={selectedRouteId}
              view={view}
              onMovePlacement={handleMovePlacement}
              onRotateSelected={handleRotate}
              onSelectPlacement={setSelectedPlacementId}
            />
            <div className={styles.sceneLegend}>
              <span>拖动岩点</span>
              <span>拖动空白处旋转 · 滚轮缩放</span>
              <span>自动吸附 200 mm 孔位</span>
              <span className={styles.collisionLegend}>红圈表示碰撞提示</span>
            </div>
          </div>
          <p className={styles.statusMessage} role="status">
            {message}
          </p>
        </div>

        <aside className={styles.sidePanel}>
          <RoutePanel
            editable={job?.status === 'DRAFT'}
            plan={plan}
            selectedRouteId={selectedRouteId}
            onHighlight={setSelectedRouteId}
            onUnmount={handleUnmountRoute}
          />
          <HoldPalette assets={assets} editable={job?.status === 'DRAFT'} plan={plan} />
          <SelectionPanel
            assets={assets}
            onDelete={handleDeletePlacement}
            placement={selectedPlacement}
            plan={plan}
            onRotate={handleRotate}
          />
          <ExportPanel
            assets={assets}
            plan={plan}
            onScreenshot={() => void sceneRef.current?.exportFrontScreenshot()}
          />
        </aside>
      </section>

      <section className={styles.calibrationNote}>
        <strong>工程边界：</strong>
        当前孔位来自扫描 PDF 的约 200 × 200 mm 估测，仅用于交互
        MVP。现场复核必须补齐网格原点、真实行列、缺失孔、边界孔、墙高与倾角后，状态才能改为“已现场校准”。
      </section>
    </div>
  );
}

function CalibrationBadge() {
  return (
    <div className={styles.calibrationBadge}>
      <span>扫描估测草案</span>
      <small>待现场复核</small>
    </div>
  );
}

function Metric(props: { detail: string; label: string; value: string; warning?: boolean }) {
  return (
    <article className={`${styles.metric} ${props.warning ? styles.metricWarning : ''}`}>
      <span>{props.label}</span>
      <strong>{props.value}</strong>
      <small>{props.detail}</small>
    </article>
  );
}

function RouteSettingToolbar(props: {
  actionBusy: boolean;
  canFocus: boolean;
  historyCount: number;
  jobStatus: WallSettingJob['status'] | null;
  placementCount: number;
  onCancel: () => void;
  onComplete: () => void;
  onFocus: () => void;
  onLock: () => void;
  onReset: () => void;
  onResetView: () => void;
  onUndo: () => void;
  onViewChange: (view: RouteSettingView) => void;
  view: RouteSettingView;
}) {
  return (
    <div className={styles.toolbar}>
      <div className={styles.segmented}>
        <button
          className={props.view === 'perspective' ? styles.active : ''}
          onClick={() => props.onViewChange('perspective')}
        >
          倾角视图
        </button>
        <button
          className={props.view === 'front' ? styles.active : ''}
          onClick={() => props.onViewChange('front')}
        >
          正立面
        </button>
      </div>
      <div className={styles.toolbarActions}>
        <button onClick={props.onResetView}>复位视角</button>
        <button disabled={!props.canFocus} onClick={props.onFocus}>
          聚焦岩点
        </button>
        <button disabled={!props.historyCount} onClick={props.onUndo}>
          撤销
        </button>
        <button disabled={props.jobStatus !== 'DRAFT'} onClick={props.onReset}>
          清空草稿
        </button>
        {props.jobStatus === 'DRAFT' && (
          <button disabled={props.actionBusy || !props.placementCount} onClick={props.onLock}>
            锁定并预留
          </button>
        )}
        {props.jobStatus === 'READY' && (
          <button disabled={props.actionBusy} onClick={props.onComplete}>
            确认安装完成
          </button>
        )}
        {(props.jobStatus === 'DRAFT' || props.jobStatus === 'READY') && (
          <button disabled={props.actionBusy} onClick={props.onCancel}>
            取消任务
          </button>
        )}
      </div>
    </div>
  );
}

function RoutePanel(props: {
  editable: boolean;
  onHighlight: (routeId: string | null) => void;
  onUnmount: (routeId: string) => void;
  plan: RouteSettingPlan;
  selectedRouteId: string | null;
}) {
  return (
    <Panel title="当前方案线路" description="首次拖入岩点会自动新建一条线路。">
      <div className={styles.routeList}>
        {props.plan.routes.map((route) => {
          const count = props.plan.placements.filter((item) => item.routeId === route.id).length;
          const active = props.selectedRouteId === route.id;
          return (
            <div
              className={`${styles.routeRow} ${active ? styles.routeActive : ''}`}
              key={route.id}
            >
              <button
                aria-pressed={active}
                className={styles.routeIdentity}
                onClick={() => props.onHighlight(active ? null : route.id)}
              >
                <i style={{ background: route.color }} />
                <span>
                  <strong>{route.name}</strong>
                  <small>{count} 个岩点</small>
                </span>
              </button>
              <button
                aria-label={`拆卸${route.name}线路`}
                className={styles.dangerText}
                disabled={!count || !props.editable}
                onClick={() => props.onUnmount(route.id)}
              >
                整线拆卸
              </button>
            </div>
          );
        })}
      </div>
    </Panel>
  );
}

function HoldPalette(props: {
  assets: HoldAssetDefinition[];
  editable: boolean;
  plan: RouteSettingPlan;
}) {
  return (
    <Panel title="岩点资产" description="草稿仅计算本任务剩余；锁定方案才正式预留。">
      <div className={styles.palette}>
        {props.assets.map((asset) => {
          const remaining = draftRemaining(asset, props.plan);
          const enabled = props.editable && asset.draggable && remaining > 0;
          return (
            <button
              draggable={enabled}
              disabled={!enabled}
              key={asset.assetId}
              className={styles.paletteItem}
              onDragStart={(event) =>
                event.dataTransfer.setData('application/x-climbing-hold', asset.assetId)
              }
              title={asset.disabledReason ?? undefined}
            >
              {asset.previewUrl ? (
                <Image alt="" height={96} src={asset.previewUrl} unoptimized width={96} />
              ) : (
                <span
                  className={styles.assetSwatch}
                  style={{ background: climbingColorCss(asset.color) }}
                />
              )}
              <span>{asset.label}</span>
              <small>
                仓库 {asset.warehouseQuantity} · 本草稿 {asset.warehouseQuantity - remaining}
                {' · '}剩余 {remaining}
              </small>
            </button>
          );
        })}
        {!props.assets.length && <p className={styles.emptyHint}>暂无已完成扫描的可用岩点。</p>}
      </div>
    </Panel>
  );
}

function SelectionPanel(props: {
  assets: HoldAssetDefinition[];
  onDelete: () => void;
  onRotate: (delta: number) => void;
  placement: RouteSettingPlan['placements'][number] | null;
  plan: RouteSettingPlan;
}) {
  const hole = props.placement ? findWallHole(props.placement.holeId) : null;
  const route = props.plan.routes.find((item) => item.id === props.placement?.routeId);
  const asset = props.placement
    ? props.assets.find((item) => item.assetId === props.placement?.assetId)
    : null;
  const mount = props.placement ? matchPlacementMount(props.placement, props.assets) : null;
  return (
    <Panel title="当前岩点" description="选中墙上的岩点后，可围绕主螺栓锚点旋转。">
      {props.placement && hole ? (
        <div className={styles.selectionDetails}>
          <dl>
            <div>
              <dt>线路</dt>
              <dd>{route?.name}</dd>
            </div>
            <div>
              <dt>孔位</dt>
              <dd>{hole.id}</dd>
            </div>
            <div>
              <dt>坐标</dt>
              <dd>
                {hole.xMm} / {hole.zMm} mm
              </dd>
            </div>
            <div>
              <dt>旋转</dt>
              <dd>{props.placement.rotationDegrees}°</dd>
            </div>
            <div>
              <dt>真实尺寸</dt>
              <dd>
                {asset
                  ? `${Math.round(asset.dimensionsMm.width)} × ${Math.round(asset.dimensionsMm.height)} × ${Math.round(asset.dimensionsMm.depth)} mm`
                  : '—'}
              </dd>
            </div>
            <div>
              <dt>安装匹配</dt>
              <dd className={mount?.valid ? styles.mountValid : styles.mountInvalid}>
                {mount?.valid
                  ? `${mount.matchedHoles.length}/${mount.matchedHoles.length} 孔匹配`
                  : '孔型不匹配'}
              </dd>
            </div>
            <div>
              <dt>锚点状态</dt>
              <dd>{asset?.mountPattern.status === 'FIELD_VERIFIED' ? '现场复核' : '扫描估测'}</dd>
            </div>
          </dl>
          <div className={styles.rotateActions}>
            <button onClick={() => props.onRotate(-15)}>左转 15°</button>
            <button onClick={() => props.onRotate(15)}>右转 15°</button>
          </div>
          <button className={styles.deletePlacement} onClick={props.onDelete} type="button">
            拆卸当前岩点
          </button>
        </div>
      ) : (
        <p className={styles.emptyHint}>点击墙上的岩点查看安装位置。</p>
      )}
    </Panel>
  );
}

function ExportPanel(props: {
  assets: HoldAssetDefinition[];
  onScreenshot: () => void;
  plan: RouteSettingPlan;
}) {
  return (
    <Panel title="交付导出" description="导出当前工作状态、安装孔位清单和正立面图片。">
      <div className={styles.exportActions}>
        <button
          onClick={() =>
            downloadTextFile(
              'W06-route-setting-plan.json',
              exportRouteSettingPlanJson(props.plan),
              'application/json',
            )
          }
        >
          导出 JSON
        </button>
        <button
          onClick={() =>
            downloadTextFile(
              'W06-孔位清单.csv',
              exportPlacementCsv(props.plan, props.assets),
              'text/csv;charset=utf-8',
            )
          }
        >
          导出孔位清单
        </button>
        <button onClick={props.onScreenshot}>导出正立面 PNG</button>
      </div>
    </Panel>
  );
}

function Panel(props: { children: React.ReactNode; description: string; title: string }) {
  return (
    <section className={styles.panel}>
      <header>
        <h2>{props.title}</h2>
        <p>{props.description}</p>
      </header>
      {props.children}
    </section>
  );
}

function planFingerprint(plan: RouteSettingPlan): string {
  return JSON.stringify({
    wallCode: plan.wall.code,
    routes: plan.routes,
    placements: plan.placements,
  });
}

function draftRemaining(asset: HoldAssetDefinition, plan: RouteSettingPlan): number {
  const used = plan.placements.filter((placement) => placement.assetId === asset.assetId).length;
  return Math.max(0, asset.warehouseQuantity - used);
}
