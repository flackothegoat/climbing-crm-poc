'use client';

import Image from 'next/image';
import { useEffect, useMemo, useRef, useState } from 'react';
import { PageHeading } from '../dashboard/page-components';
import { W06_HOLES } from '../walls/w06-wall-data';
import {
  ensureW06DemoData,
  getRouteSettingPlan,
  saveRouteSettingPlan,
} from '../walls/wall-persistence-api';
import { HOLD_ASSETS, createSeedRouteSettingPlan } from './route-setting-demo-data';
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
import type { HoldColor, RouteSettingPlan, RouteSettingView } from './route-setting.types';
import styles from './route-setting.module.css';

export function RouteSettingStudio() {
  const [plan, setPlan] = useState<RouteSettingPlan>(() => createSeedRouteSettingPlan());
  const [history, setHistory] = useState<RouteSettingPlan[]>([]);
  const [hydrated, setHydrated] = useState(false);
  const [message, setMessage] = useState('拖动岩点即可吸附到最近孔位。');
  const [selectedPlacementId, setSelectedPlacementId] = useState<string | null>(null);
  const [selectedRouteId, setSelectedRouteId] = useState<string | null>(null);
  const [view, setView] = useState<RouteSettingView>('perspective');
  const sceneRef = useRef<RouteSettingSceneHandle>(null);
  const lastSavedPlanRef = useRef('');
  const collisions = useMemo(() => findPlacementCollisions(plan), [plan]);
  const selectedPlacement = plan.placements.find((item) => item.id === selectedPlacementId) ?? null;

  useEffect(() => {
    let active = true;
    async function loadPersistedPlan() {
      setMessage('正在从数据库读取 W06 定线计划…');
      try {
        await ensureW06DemoData();
        const persistedPlan = await getRouteSettingPlan('W06');
        if (!active) return;
        lastSavedPlanRef.current = planFingerprint(persistedPlan);
        setPlan(persistedPlan);
        setHydrated(true);
        setMessage('已载入数据库定线计划；后续修改将自动保存。');
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
      void saveRouteSettingPlan(plan)
        .then(() => {
          lastSavedPlanRef.current = fingerprint;
          setMessage('定线草稿已保存到数据库。');
        })
        .catch((error: unknown) =>
          setMessage(error instanceof Error ? error.message : '定线草稿保存失败'),
        );
    }, 700);
    return () => window.clearTimeout(timeout);
  }, [hydrated, plan]);

  function commit(next: RouteSettingPlan, successMessage: string): void {
    setHistory((items) => [...items.slice(-19), plan]);
    setPlan(next);
    setMessage(successMessage);
  }

  function handleMovePlacement(placementId: string, holeId: string): void {
    const next = movePlacement(plan, placementId, holeId);
    if (placementHasMountConflict(next, placementId)) {
      return setMessage(`${holeId} 无法满足安装孔型，或所需孔位已被占用。`);
    }
    commit(next, `已吸附到 ${holeId}，安装孔型匹配。`);
  }

  function handleRotate(deltaDegrees: number): void {
    if (!selectedPlacement) return;
    const next = rotatePlacement(plan, selectedPlacement.id, deltaDegrees);
    if (placementHasMountConflict(next, selectedPlacement.id)) {
      return setMessage('该角度无法让全部安装孔匹配当前墙面网格。');
    }
    commit(next, `岩点已旋转 ${deltaDegrees > 0 ? '+' : ''}${deltaDegrees}°。`);
  }

  function handleUnmountRoute(routeId: string): void {
    const route = plan.routes.find((item) => item.id === routeId);
    const count = plan.placements.filter((item) => item.routeId === routeId).length;
    if (!count) return setMessage(`${route?.name ?? '该线路'}当前没有已安装岩点。`);
    commit(
      removeRoutePlacements(plan, routeId),
      `已拆卸“${route?.name}”的 ${count} 个岩点，可撤销。`,
    );
    setSelectedPlacementId(null);
  }

  function handleDeletePlacement(): void {
    if (!selectedPlacement) return;
    commit(
      removePlacement(plan, selectedPlacement.id),
      `已拆卸 ${selectedPlacement.holeId} 的岩点。`,
    );
    setSelectedPlacementId(null);
  }

  function handleUndo(): void {
    const previous = history.at(-1);
    if (!previous) return;
    setPlan(previous);
    setHistory((items) => items.slice(0, -1));
    setSelectedPlacementId(null);
    setMessage('已撤销上一步操作。');
  }

  function handleDrop(event: React.DragEvent<HTMLDivElement>): void {
    event.preventDefault();
    const color = event.dataTransfer.getData('application/x-climbing-hold') as HoldColor;
    const asset = HOLD_ASSETS[color];
    const holeId = sceneRef.current?.pickHoleAtClient(event.clientX, event.clientY);
    if (!asset || !holeId) return setMessage('请把岩点放在墙面范围内。');
    if (plan.placements.some((placement) => placement.holeId === holeId)) {
      return setMessage(`${holeId} 已被占用，请选择相邻孔位。`);
    }
    const routeId = selectedRouteId ?? `route-${color}`;
    const next = addPlacement(plan, {
      assetId: asset.assetId,
      routeId,
      holeId,
      role: 'NORMAL',
      rotationDegrees: 0,
    });
    const added = next.placements.at(-1);
    if (!added || placementHasMountConflict(next, added.id)) {
      return setMessage(`${asset.label}的安装孔型无法匹配该位置。`);
    }
    commit(next, `${asset.label}已安装到 ${holeId}，安装孔型匹配。`);
  }

  function handleReset(): void {
    commit(createSeedRouteSettingPlan(), '已恢复红、绿、黄三条测试线路。');
    setSelectedPlacementId(null);
    setSelectedRouteId(null);
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
        <Metric label="已安装" value={String(plan.placements.length)} detail="3 个清理岩点资产" />
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
            canFocus={Boolean(selectedPlacement)}
            historyCount={history.length}
            onFocus={() => sceneRef.current?.focusSelected()}
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
            plan={plan}
            selectedRouteId={selectedRouteId}
            onHighlight={setSelectedRouteId}
            onUnmount={handleUnmountRoute}
          />
          <HoldPalette />
          <SelectionPanel
            onDelete={handleDeletePlacement}
            placement={selectedPlacement}
            plan={plan}
            onRotate={handleRotate}
          />
          <ExportPanel
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
  canFocus: boolean;
  historyCount: number;
  onFocus: () => void;
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
        <button onClick={props.onReset}>恢复测试线路</button>
      </div>
    </div>
  );
}

function RoutePanel(props: {
  onHighlight: (routeId: string | null) => void;
  onUnmount: (routeId: string) => void;
  plan: RouteSettingPlan;
  selectedRouteId: string | null;
}) {
  return (
    <Panel title="测试线路" description="点击线路高亮；拆卸后可用顶部撤销恢复。">
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
                <i className={styles[route.color]} />
                <span>
                  <strong>{route.name}</strong>
                  <small>{count} 个岩点</small>
                </span>
              </button>
              <button
                aria-label={`拆卸${route.name}线路`}
                className={styles.dangerText}
                disabled={!count}
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

function HoldPalette() {
  return (
    <Panel title="岩点资产" description="拖动清理后的资产到墙面；当前不联动库存。">
      <div className={styles.palette}>
        {Object.values(HOLD_ASSETS).map((asset) => (
          <button
            draggable
            key={asset.assetId}
            className={styles.paletteItem}
            onDragStart={(event) =>
              event.dataTransfer.setData('application/x-climbing-hold', asset.color)
            }
          >
            <Image
              alt=""
              height={96}
              src={`/walls/w06/qa/${asset.color}-clean-top.png`}
              width={96}
            />
            <span>{asset.label}</span>
          </button>
        ))}
      </div>
    </Panel>
  );
}

function SelectionPanel(props: {
  onDelete: () => void;
  onRotate: (delta: number) => void;
  placement: RouteSettingPlan['placements'][number] | null;
  plan: RouteSettingPlan;
}) {
  const hole = props.placement ? findWallHole(props.placement.holeId) : null;
  const route = props.plan.routes.find((item) => item.id === props.placement?.routeId);
  const asset = props.placement
    ? Object.values(HOLD_ASSETS).find((item) => item.assetId === props.placement?.assetId)
    : null;
  const mount = props.placement ? matchPlacementMount(props.placement) : null;
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

function ExportPanel(props: { onScreenshot: () => void; plan: RouteSettingPlan }) {
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
              exportPlacementCsv(props.plan),
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
