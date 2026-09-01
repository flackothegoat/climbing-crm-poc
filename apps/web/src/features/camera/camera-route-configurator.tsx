'use client';

import {
  useEffect,
  useMemo,
  useRef,
  useState,
  type FormEvent,
  type PointerEvent as ReactPointerEvent,
} from 'react';
import {
  climbingColorLabel,
  climbingColorOptions,
  type ClimbingColor,
} from '../common/climbing-colors';
import {
  createOperationalRoute,
  publishOperationalRoute,
  uploadRoutePhoto,
  type OperationalRoute,
} from '../routes/route-operations-api';
import {
  getCameraRouteWorkspace,
  getCameraSnapshot,
  saveCameraRouteDefinition,
  type CameraRoi,
  type CameraRouteHold,
  type CameraRouteWorkspace,
} from './camera-live-api';
import { detectHoldCandidates } from './detect-hold-candidates';
import {
  preparePromptSegmentation,
  segmentHoldLocally,
  type PromptSegmentationSession,
} from './prompt-segment-hold';
import { roiForHolds } from './camera-route-selection';
import styles from './camera-route-configurator.module.css';

type EditMode = 'PROMPT' | 'START' | 'FINISH' | 'ROI' | 'MANUAL' | 'MERGE';
type SelectableMode = 'PROMPT' | 'MANUAL' | 'START' | 'FINISH';
type Workflow = 'CREATE' | 'BIND';
const defaultRoi: CameraRoi = { x1: 0.04, y1: 0.08, x2: 0.96, y2: 0.96 };

export function CameraRouteConfigurator() {
  const [workspace, setWorkspace] = useState<CameraRouteWorkspace | null>(null);
  const [routeId, setRouteId] = useState('');
  const [wallSegmentId, setWallSegmentId] = useState('');
  const [snapshotUrl, setSnapshotUrl] = useState('');
  const [imageSize, setImageSize] = useState({ width: 1280, height: 720 });
  const [roi, setRoi] = useState<CameraRoi>(defaultRoi);
  const [draftRoi, setDraftRoi] = useState<CameraRoi | null>(null);
  const [draftPromptBox, setDraftPromptBox] = useState<CameraRoi | null>(null);
  const [candidates, setCandidates] = useState<CameraRouteHold[]>([]);
  const [activeCluster, setActiveCluster] = useState<string | null>(null);
  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  const [startIds, setStartIds] = useState<string[]>([]);
  const [finishIds, setFinishIds] = useState<string[]>([]);
  const [mergeIds, setMergeIds] = useState<string[]>([]);
  const [focusedHoldId, setFocusedHoldId] = useState('');
  const [mode, setMode] = useState<EditMode>('PROMPT');
  const [workflow, setWorkflow] = useState<Workflow>('CREATE');
  const [routeSearch, setRouteSearch] = useState('');
  const [showCreateRoute, setShowCreateRoute] = useState(false);
  const [createError, setCreateError] = useState('');
  const [newRoute, setNewRoute] = useState({
    name: '',
    color: 'YELLOW' as ClimbingColor,
    grade: 'V3',
    gradeSystem: 'V',
    styleTags: '',
    wallSegmentId: '',
  });
  const [pendingRoute, setPendingRoute] = useState<OperationalRoute | null>(null);
  const [message, setMessage] = useState('框选一块岩点，智能轮廓会自动加入当前线路。');
  const [busy, setBusy] = useState(false);
  const imageRef = useRef<HTMLImageElement | null>(null);
  const snapshotUrlRef = useRef('');
  const promptSessionRef = useRef<Promise<PromptSegmentationSession> | null>(null);
  const dragStart = useRef<{ x: number; y: number } | null>(null);
  const preserveDraftForRouteId = useRef('');
  const creationSuccessForRouteId = useRef('');

  useEffect(() => {
    getCameraRouteWorkspace()
      .then((value) => {
        setWorkspace(value);
      })
      .catch((error: unknown) =>
        setMessage(error instanceof Error ? error.message : '线路配置读取失败'),
      );
    void refreshSnapshot();
    return () => {
      if (snapshotUrlRef.current) URL.revokeObjectURL(snapshotUrlRef.current);
    };
  }, []);

  const route = workspace?.routes.find((item) => item.id === routeId) ?? null;
  const matchingRoutes = useMemo(() => {
    const query = routeSearch.trim().toLowerCase();
    return (
      workspace?.routes.filter(
        (item) =>
          item.id === routeId ||
          !query ||
          [
            item.code,
            item.name,
            item.grade,
            item.color,
            climbingColorLabel(item.color as ClimbingColor),
          ].some((value) => value.toLowerCase().includes(query)),
      ) ?? []
    );
  }, [routeId, routeSearch, workspace]);
  const availableWalls = useMemo(
    () =>
      workspace?.wallSegments.filter((wall) => route?.version.wallSegmentIds.includes(wall.id)) ??
      [],
    [route, workspace],
  );
  const clusters = useMemo(() => {
    const result = new Map<string, { color: string; count: number }>();
    for (const hold of candidates.filter((candidate) => candidate.source === 'AUTO_COLOR')) {
      const item = result.get(hold.colorCluster);
      result.set(hold.colorCluster, {
        color: hold.colorHex,
        count: (item?.count ?? 0) + 1,
      });
    }
    return [...result.entries()];
  }, [candidates]);
  const visibleCandidates = useMemo(() => {
    if (activeCluster) {
      return candidates.filter(
        (hold) => hold.colorCluster === activeCluster || selectedIds.includes(hold.id),
      );
    }
    return [...candidates]
      .filter((hold) => selectedIds.includes(hold.id) || (hold.confidence ?? 1) >= 0.62)
      .sort((a, b) => (b.confidence ?? 1) - (a.confidence ?? 1))
      .slice(0, 48);
  }, [activeCluster, candidates, selectedIds]);
  const selectedHolds = useMemo(
    () => candidates.filter((hold) => selectedIds.includes(hold.id)),
    [candidates, selectedIds],
  );
  const effectiveRoi = useMemo(() => roiForHolds(selectedHolds, roi), [roi, selectedHolds]);
  const focusedHold = candidates.find((hold) => hold.id === focusedHoldId) ?? null;

  useEffect(() => {
    if (workflow !== 'BIND' || !route || !workspace) return;
    const existing = workspace.definitions.find(
      (definition) => definition.routeVersion.id === route.version.id,
    );
    if (existing) {
      preserveDraftForRouteId.current = '';
      setWallSegmentId(existing.wallSegment.id);
      setRoi(existing.roi);
      setCandidates(existing.holds);
      setActiveCluster(null);
      setSelectedIds(existing.holds.map((hold) => hold.id));
      setStartIds(existing.startHoldIds);
      setFinishIds(existing.finishHoldIds);
      setMergeIds([]);
      setFocusedHoldId('');
      if (creationSuccessForRouteId.current === route.id) {
        creationSuccessForRouteId.current = '';
        setMessage(`线路 ${route.code} 创建成功，视觉定义和线路图片已保存。`);
      } else {
        setMessage(`已载入修订 ${existing.revision}，可以继续修正。`);
      }
      return;
    }
    setWallSegmentId(route.version.wallSegmentIds[0] ?? '');
    if (preserveDraftForRouteId.current === route.id) {
      preserveDraftForRouteId.current = '';
      setMessage(`已创建并匹配业务线路 ${route.code}，请继续保存当前视觉定义。`);
      return;
    }
    setSelectedIds([]);
    setActiveCluster(null);
    setStartIds([]);
    setFinishIds([]);
    setMergeIds([]);
    setFocusedHoldId('');
    setMessage('该线路尚未配置，请使用“添加岩点”逐块标注。');
  }, [route, workflow, workspace]);

  function openRouteCreator() {
    const holds = candidates.filter((hold) => selectedIds.includes(hold.id));
    if (holds.length < 2 || !startIds.length || !finishIds.length) {
      setMessage('进入线路信息前，请至少确认两个线路岩点，并分别指定起点和终点。');
      return;
    }
    const selectedWall =
      wallSegmentId || route?.version.wallSegmentIds[0] || workspace?.wallSegments[0]?.id || '';
    setNewRoute((current) => ({
      ...current,
      color: suggestedClimbingColor(holds),
      wallSegmentId: selectedWall,
    }));
    setCreateError('');
    setShowCreateRoute(true);
  }

  async function createRoute(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!newRoute.wallSegmentId) {
      setCreateError('请先选择线路所在墙段。');
      return;
    }
    const holds = candidates.filter((hold) => selectedIds.includes(hold.id));
    if (holds.length < 2 || !startIds.length || !finishIds.length) {
      setCreateError('请先完成线路岩点、起点和终点确认。');
      return;
    }
    const image = imageRef.current;
    if (!image) {
      setCreateError('线路截图尚未载入，请刷新无人墙面。');
      return;
    }
    setBusy(true);
    setCreateError('');
    let created = pendingRoute;
    try {
      created ??= await createOperationalRoute({
        name: newRoute.name,
        color: newRoute.color,
        grade: newRoute.grade,
        gradeSystem: newRoute.gradeSystem,
        styleTags: newRoute.styleTags
          .split(/[，,]/)
          .map((tag) => tag.trim())
          .filter(Boolean),
        setterMembershipId: null,
        wallSegmentIds: [newRoute.wallSegmentId],
        expectedRetireAt: null,
      });
      setPendingRoute(created);
      if (!created.version) throw new Error('新线路没有可用版本');
      await saveCameraRouteDefinition({
        routeId: created.id,
        routeVersionId: created.version.id,
        wallSegmentId: newRoute.wallSegmentId,
        referenceWidth: imageSize.width,
        referenceHeight: imageSize.height,
        roi: effectiveRoi,
        holds,
        startHoldIds: startIds,
        finishHoldIds: finishIds,
      });
      const photo = await createAnnotatedRoutePhoto(
        image,
        effectiveRoi,
        holds,
        startIds,
        finishIds,
      );
      await uploadRoutePhoto(created.id, photo);
      if (created.status !== 'PUBLISHED') {
        created = await publishOperationalRoute(created.id);
        setPendingRoute(created);
      }
      const refreshed = await getCameraRouteWorkspace();
      creationSuccessForRouteId.current = created.id;
      setWorkspace(refreshed);
      setRouteId(created.id);
      setWallSegmentId(newRoute.wallSegmentId);
      setRouteSearch('');
      setShowCreateRoute(false);
      setPendingRoute(null);
      setWorkflow('BIND');
    } catch (error) {
      preserveDraftForRouteId.current = '';
      setCreateError(
        `${
          created
            ? created.status === 'PUBLISHED'
              ? `线路 ${created.code} 已创建成功，可重试刷新。`
              : `线路 ${created.code} 已保留为草稿，可直接重试。`
            : ''
        }${error instanceof Error ? error.message : '线路创建失败'}`,
      );
    } finally {
      setBusy(false);
    }
  }

  async function refreshSnapshot() {
    setBusy(true);
    try {
      const snapshot = await getCameraSnapshot();
      const next = URL.createObjectURL(snapshot.blob);
      if (snapshotUrlRef.current) URL.revokeObjectURL(snapshotUrlRef.current);
      snapshotUrlRef.current = next;
      promptSessionRef.current = null;
      setSnapshotUrl(next);
      setMode('PROMPT');
      setMessage(
        snapshot.stale
          ? `实时截帧暂时失败，已显示 ${formatSnapshotTime(snapshot.capturedAt)} 的最近成功画面；请确认墙面未变化。`
          : '截图已更新。确认画面无人后，框选第一块岩点。',
      );
    } catch (error) {
      setMessage(error instanceof Error ? error.message : '实时截图失败');
    } finally {
      setBusy(false);
    }
  }

  function detectCandidates() {
    const image = imageRef.current;
    if (!image) return;
    const canvas = document.createElement('canvas');
    canvas.width = image.naturalWidth;
    canvas.height = image.naturalHeight;
    const context = canvas.getContext('2d', { willReadFrequently: true });
    if (!context) return;
    context.drawImage(image, 0, 0);
    const detected = detectHoldCandidates(
      context.getImageData(0, 0, canvas.width, canvas.height),
      roi,
    );
    setCandidates(detected);
    setActiveCluster(null);
    setSelectedIds([]);
    setStartIds([]);
    setFinishIds([]);
    setMergeIds([]);
    setMode('PROMPT');
    const initiallyVisible = detected.filter((hold) => (hold.confidence ?? 1) >= 0.62).length;
    setMessage(
      detected.length
        ? `检测到 ${detected.length} 个实验候选，当前显示 ${Math.min(48, initiallyVisible)} 个高置信度轮廓；也可继续用 SAM 逐块补充。`
        : '没有检测到可靠候选，请继续使用“添加岩点”逐块框选。',
    );
  }

  function handlePointerDown(event: ReactPointerEvent<SVGSVGElement>) {
    if (mode !== 'ROI' && mode !== 'PROMPT') return;
    const point = normalizedPoint(event);
    dragStart.current = point;
    event.currentTarget.setPointerCapture(event.pointerId);
    const draft = { x1: point.x, y1: point.y, x2: point.x, y2: point.y };
    if (mode === 'ROI') setDraftRoi(draft);
    else setDraftPromptBox(draft);
  }

  function handlePointerMove(event: ReactPointerEvent<SVGSVGElement>) {
    if ((mode !== 'ROI' && mode !== 'PROMPT') || !dragStart.current) return;
    const draft = rectFromPoints(dragStart.current, normalizedPoint(event));
    if (mode === 'ROI') setDraftRoi(draft);
    else setDraftPromptBox(draft);
  }

  function handlePointerUp(event: ReactPointerEvent<SVGSVGElement>) {
    if ((mode !== 'ROI' && mode !== 'PROMPT') || !dragStart.current) return;
    const start = dragStart.current;
    const end = normalizedPoint(event);
    let next = rectFromPoints(start, end);
    dragStart.current = null;
    if (mode === 'PROMPT') {
      setDraftPromptBox(null);
      if (next.x2 - next.x1 < 0.012 || next.y2 - next.y1 < 0.012) {
        next = promptBoxAround(end, imageSize);
      }
      const promptPoint = {
        x: (next.x1 + next.x2) / 2,
        y: (next.y1 + next.y2) / 2,
      };
      void segmentPromptHold(next, promptPoint);
      return;
    }
    setDraftRoi(null);
    if (next.x2 - next.x1 < 0.05 || next.y2 - next.y1 < 0.05) {
      setMessage('识别区域太小，请重新拖拽。');
      return;
    }
    setRoi(next);
    setMode('PROMPT');
    setMessage('实验批量识别范围已更新，已有线路岩点不受影响。');
  }

  function handleCanvasClick(event: ReactPointerEvent<SVGSVGElement>) {
    if (
      mode === 'ROI' ||
      mode === 'PROMPT' ||
      mode === 'MERGE' ||
      event.target !== event.currentTarget
    )
      return;
    const point = normalizedPoint(event);
    if (!insideRoi(point, roi)) {
      setMessage('请在线路识别区域内添加岩点。');
      return;
    }
    const hold: CameraRouteHold = {
      id: `manual-${Date.now()}-${Math.round(point.x * 1000)}-${Math.round(point.y * 1000)}`,
      x: point.x,
      y: point.y,
      width: 0.035,
      height: 0.05,
      polygon: ellipsePolygon(point.x, point.y, 0.035, 0.05),
      colorHex: '#FFFFFF',
      colorCluster: 'manual',
      confidence: 1,
      source: 'MANUAL',
    };
    setCandidates((items) => [...items, hold]);
    selectHold(hold.id, mode);
  }

  async function segmentPromptHold(box: CameraRoi, point: { x: number; y: number }) {
    const image = imageRef.current;
    if (!image) return;
    setBusy(true);
    let usedFallback = false;
    try {
      promptSessionRef.current ??= preparePromptSegmentation(image, (progress) => {
        if (progress.phase === 'MODEL') {
          const percentage =
            typeof progress.progress === 'number' ? ` ${Math.round(progress.progress)}%` : '';
          setMessage(`首次加载轻量级 SAM${percentage}，模型会缓存在浏览器中…`);
        } else if (progress.phase === 'EMBEDDING') {
          setMessage('正在计算当前无人墙面特征；同一截图只需执行一次…');
        } else {
          setMessage('SAM 正在提取框内单块岩点轮廓…');
        }
      });
      const session = await promptSessionRef.current;
      const hold = await session.segment(box, point);
      applyPromptHold(hold, point);
    } catch (error) {
      promptSessionRef.current = null;
      try {
        usedFallback = true;
        const hold = segmentHoldLocally(image, box, point);
        applyPromptHold(hold, point);
      } catch (fallbackError) {
        usedFallback = false;
        setMessage(
          `${error instanceof Error ? error.message : 'SAM 分割失败'}；${
            fallbackError instanceof Error ? fallbackError.message : '局部分割也未找到岩点'
          }`,
        );
      }
    } finally {
      setBusy(false);
      if (usedFallback) {
        setMessage('SAM 暂不可用，已使用框内局部分割兜底；请检查轮廓，必要时重新缩小框选。');
      }
    }
  }

  function applyPromptHold(hold: CameraRouteHold, point: { x: number; y: number }) {
    const replacedIds = candidates
      .filter(
        (candidate) => candidate.source === 'AUTO_COLOR' && pointInsideHoldBounds(point, candidate),
      )
      .map((candidate) => candidate.id);
    setCandidates((items) => [
      ...items.filter((candidate) => !replacedIds.includes(candidate.id)),
      hold,
    ]);
    setSelectedIds((ids) => [
      ...ids.filter((id) => !replacedIds.includes(id) && id !== hold.id),
      hold.id,
    ]);
    setStartIds((ids) => ids.filter((id) => !replacedIds.includes(id)));
    setFinishIds((ids) => ids.filter((id) => !replacedIds.includes(id)));
    setActiveCluster(null);
    setFocusedHoldId(hold.id);
    setMessage('已添加一个独立岩点。再次点击该轮廓可取消选择，或继续框选下一块。');
  }

  function selectHold(id: string, targetMode: SelectableMode) {
    setFocusedHoldId(id);
    if (targetMode === 'PROMPT' || targetMode === 'MANUAL') {
      const wasSelected = selectedIds.includes(id);
      setSelectedIds((ids) =>
        ids.includes(id) ? ids.filter((value) => value !== id) : [...ids, id],
      );
      if (wasSelected) {
        setStartIds((ids) => ids.filter((value) => value !== id));
        setFinishIds((ids) => ids.filter((value) => value !== id));
      }
      setMessage(wasSelected ? '已取消选择该岩点。' : '已将该岩点加入线路。');
      return;
    }
    setSelectedIds((ids) => (ids.includes(id) ? ids : [...ids, id]));
    if (targetMode === 'START') {
      setStartIds((ids) => (ids.includes(id) ? ids.filter((value) => value !== id) : [...ids, id]));
      setFinishIds((ids) => ids.filter((value) => value !== id));
      setMessage(startIds.includes(id) ? '已取消起点标记。' : '已标记起点。');
    } else {
      setFinishIds((ids) =>
        ids.includes(id) ? ids.filter((value) => value !== id) : [...ids, id],
      );
      setStartIds((ids) => ids.filter((value) => value !== id));
      setMessage(finishIds.includes(id) ? '已取消终点标记。' : '已标记终点。');
    }
  }

  function deleteFocusedHold() {
    if (!focusedHold) return;
    const id = focusedHold.id;
    setCandidates((items) => items.filter((hold) => hold.id !== id));
    setSelectedIds((ids) => ids.filter((value) => value !== id));
    setStartIds((ids) => ids.filter((value) => value !== id));
    setFinishIds((ids) => ids.filter((value) => value !== id));
    setMergeIds((ids) => ids.filter((value) => value !== id));
    setFocusedHoldId('');
    setMessage('已删除错误轮廓，可重新框选该岩点。');
  }

  function selectMergeHold(id: string) {
    const nextIds = mergeIds.includes(id)
      ? mergeIds.filter((value) => value !== id)
      : [...mergeIds, id].slice(-2);
    setMergeIds(nextIds);
    if (nextIds.length < 2) {
      setMessage('再点击同一物理岩点的另一块轮廓，系统会把两块合并。');
      return;
    }
    const sourceHolds = nextIds
      .map((holdId) => candidates.find((hold) => hold.id === holdId))
      .filter((hold): hold is CameraRouteHold => Boolean(hold));
    if (sourceHolds.length !== 2) return;
    const merged = mergeHoldPair(sourceHolds[0]!, sourceHolds[1]!);
    setCandidates((items) => [...items.filter((hold) => !nextIds.includes(hold.id)), merged]);
    setSelectedIds((ids) => [...ids.filter((holdId) => !nextIds.includes(holdId)), merged.id]);
    setStartIds((ids) =>
      ids.some((holdId) => nextIds.includes(holdId))
        ? [...ids.filter((holdId) => !nextIds.includes(holdId)), merged.id]
        : ids,
    );
    setFinishIds((ids) =>
      ids.some((holdId) => nextIds.includes(holdId))
        ? [...ids.filter((holdId) => !nextIds.includes(holdId)), merged.id]
        : ids,
    );
    setMergeIds([]);
    setFocusedHoldId(merged.id);
    setMode('PROMPT');
    setMessage('两块轮廓已合并为一个物理岩点，并保留在线路中。');
  }

  function selectCluster(cluster: string) {
    const ids = candidates
      .filter((hold) => hold.colorCluster === cluster && insideRoi(hold, roi))
      .map((hold) => hold.id);
    setSelectedIds((selected) => [...new Set([...selected, ...ids])]);
    setActiveCluster(cluster);
    setMessage(`已选择该颜色组的 ${ids.length} 个候选，请点击画面修正。`);
  }

  async function save() {
    if (!route || !wallSegmentId) return;
    const holds = candidates.filter((hold) => selectedIds.includes(hold.id));
    if (holds.length < 2 || !startIds.length || !finishIds.length) {
      setMessage('保存前至少选择两个线路岩点，并分别指定起点和终点。');
      return;
    }
    setBusy(true);
    try {
      const saved = await saveCameraRouteDefinition({
        routeId: route.id,
        routeVersionId: route.version.id,
        wallSegmentId,
        referenceWidth: imageSize.width,
        referenceHeight: imageSize.height,
        roi: effectiveRoi,
        holds,
        startHoldIds: startIds,
        finishHoldIds: finishIds,
      });
      const refreshed = await getCameraRouteWorkspace();
      setWorkspace(refreshed);
      setMessage(`已保存 ${saved.route.code} 修订 ${saved.revision}，Worker 可读取该定义。`);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : '线路视觉定义保存失败');
    } finally {
      setBusy(false);
    }
  }

  const visibleRoi = draftRoi ?? roi;
  return (
    <section className={styles.configurator}>
      <header>
        <div>
          <small>CAMERA ROUTE SETUP</small>
          <h3>多线路视觉配置</h3>
        </div>
        <p>SAM 逐块生成精确轮廓；只有已选岩点及其起点、终点会供 Worker 使用。</p>
      </header>
      <div className={styles.layout}>
        <div className={styles.canvasColumn}>
          <div className={styles.toolbar}>
            {(['PROMPT', 'START', 'FINISH'] as EditMode[]).map((item) => (
              <button
                data-active={mode === item}
                key={item}
                type="button"
                onClick={() => setMode(item)}
              >
                {modeLabel(item)}
              </button>
            ))}
            <button disabled={busy} type="button" onClick={() => void refreshSnapshot()}>
              刷新无人墙面
            </button>
            <details className={styles.advancedTools}>
              <summary>高级修正</summary>
              <div>
                {(['ROI', 'MANUAL', 'MERGE'] as EditMode[]).map((item) => (
                  <button
                    data-active={mode === item}
                    key={item}
                    type="button"
                    onClick={() => setMode(item)}
                  >
                    {modeLabel(item)}
                  </button>
                ))}
                <button disabled={busy || !snapshotUrl} type="button" onClick={detectCandidates}>
                  批量候选（实验）
                </button>
              </div>
            </details>
          </div>
          <div className={styles.cameraCanvas}>
            {snapshotUrl ? (
              <>
                {/* Blob snapshots cannot use the Next.js image optimizer. */}
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img
                  alt="摄像头线路配置参考画面"
                  draggable={false}
                  ref={imageRef}
                  src={snapshotUrl}
                  onLoad={(event) =>
                    setImageSize({
                      width: event.currentTarget.naturalWidth,
                      height: event.currentTarget.naturalHeight,
                    })
                  }
                />
                <svg
                  aria-label="摄像头线路标注画布"
                  preserveAspectRatio="none"
                  viewBox="0 0 1000 1000"
                  onClick={handleCanvasClick}
                  onPointerDown={handlePointerDown}
                  onPointerMove={handlePointerMove}
                  onPointerUp={handlePointerUp}
                >
                  {mode === 'ROI' ? (
                    <rect
                      className={styles.roi}
                      height={(visibleRoi.y2 - visibleRoi.y1) * 1000}
                      width={(visibleRoi.x2 - visibleRoi.x1) * 1000}
                      x={visibleRoi.x1 * 1000}
                      y={visibleRoi.y1 * 1000}
                    />
                  ) : null}
                  {draftPromptBox ? (
                    <rect
                      className={styles.promptBox}
                      height={(draftPromptBox.y2 - draftPromptBox.y1) * 1000}
                      width={(draftPromptBox.x2 - draftPromptBox.x1) * 1000}
                      x={draftPromptBox.x1 * 1000}
                      y={draftPromptBox.y1 * 1000}
                    />
                  ) : null}
                  {visibleCandidates.map((hold) => {
                    const selected = selectedIds.includes(hold.id);
                    const role = startIds.includes(hold.id)
                      ? 'start'
                      : finishIds.includes(hold.id)
                        ? 'finish'
                        : mergeIds.includes(hold.id)
                          ? 'merge'
                          : selected
                            ? 'route'
                            : 'candidate';
                    return (
                      <g
                        key={hold.id}
                        onPointerDown={(event) => event.stopPropagation()}
                        onPointerUp={(event) => event.stopPropagation()}
                        onClick={(event) => {
                          event.stopPropagation();
                          if (mode === 'MERGE') selectMergeHold(hold.id);
                          else if (
                            mode === 'PROMPT' ||
                            mode === 'MANUAL' ||
                            mode === 'START' ||
                            mode === 'FINISH'
                          ) {
                            selectHold(hold.id, mode);
                          }
                        }}
                      >
                        {hold.polygon?.length ? (
                          <path
                            className={styles.hold}
                            d={holdPath(hold)}
                            data-role={role}
                            fill={hold.colorHex}
                          />
                        ) : (
                          <ellipse
                            className={styles.hold}
                            cx={hold.x * 1000}
                            cy={hold.y * 1000}
                            data-role={role}
                            fill={hold.colorHex}
                            rx={(hold.width * 1000) / 2}
                            ry={(hold.height * 1000) / 2}
                          />
                        )}
                        {role === 'start' || role === 'finish' ? (
                          <text className={styles.holdLabel} x={hold.x * 1000} y={hold.y * 1000}>
                            {role === 'start' ? 'S' : 'F'}
                          </text>
                        ) : null}
                      </g>
                    );
                  })}
                </svg>
              </>
            ) : (
              <div className={styles.loading}>正在获取摄像头静态画面…</div>
            )}
          </div>
          <p className={styles.message}>{message}</p>
        </div>
        <aside className={styles.controls}>
          <div className={styles.workflowTabs}>
            <button
              data-active={workflow === 'CREATE'}
              type="button"
              onClick={() => {
                setWorkflow('CREATE');
                setRouteId('');
                setShowCreateRoute(false);
                setPendingRoute(null);
                setCreateError('');
                setSelectedIds([]);
                setActiveCluster(null);
                setStartIds([]);
                setFinishIds([]);
                setMergeIds([]);
                setFocusedHoldId('');
                setMode('PROMPT');
                setMessage('请逐块添加线路岩点，再标记起点和终点。');
              }}
            >
              创建新线路
            </button>
            <button
              data-active={workflow === 'BIND'}
              type="button"
              onClick={() => {
                setWorkflow('BIND');
                setRouteId((current) => current || workspace?.routes[0]?.id || '');
                setShowCreateRoute(false);
              }}
            >
              绑定已有线路
            </button>
          </div>
          {workflow === 'BIND' && (
            <>
              <label>
                搜索线路库
                <input
                  value={routeSearch}
                  placeholder="编号、名称、难度或颜色"
                  onChange={(event) => setRouteSearch(event.target.value)}
                />
              </label>
              <label>
                匹配线路
                <select value={routeId} onChange={(event) => setRouteId(event.target.value)}>
                  {!matchingRoutes.length && <option value="">没有匹配线路</option>}
                  {matchingRoutes.map((item) => (
                    <option key={item.id} value={item.id}>
                      {item.code} · {item.name} · {statusLabel(item.status)} · 版本{' '}
                      {item.version.number}
                    </option>
                  ))}
                </select>
              </label>
              {route && (
                <p className={styles.routeMatch}>
                  已匹配线路库：{route.code} · {climbingColorLabel(route.color as ClimbingColor)} ·
                  难度 {route.grade} · {statusLabel(route.status)}
                </p>
              )}
              <label>
                墙段
                <select
                  value={wallSegmentId}
                  onChange={(event) => setWallSegmentId(event.target.value)}
                >
                  {availableWalls.map((wall) => (
                    <option key={wall.id} value={wall.id}>
                      {wall.code} · {wall.name}
                    </option>
                  ))}
                </select>
              </label>
            </>
          )}
          {workflow === 'CREATE' && (
            <p className={styles.stepNotice}>
              {showCreateRoute ? '第 2 步：确认线路信息' : '第 1 步：添加全部岩点并标记起终点'}
            </p>
          )}
          <div className={styles.summary}>
            <span>
              候选岩点<strong>{candidates.length}</strong>
            </span>
            <span>
              已选岩点<strong>{selectedIds.length}</strong>
            </span>
            <span>
              起点<strong>{startIds.length}</strong>
            </span>
            <span>
              终点<strong>{finishIds.length}</strong>
            </span>
          </div>
          {!showCreateRoute && focusedHold && (
            <div className={styles.focusedHoldActions}>
              <span>当前岩点 · {selectedIds.includes(focusedHold.id) ? '已选择' : '未选择'}</span>
              <button type="button" onClick={deleteFocusedHold}>
                删除错误轮廓
              </button>
            </div>
          )}
          {!showCreateRoute && clusters.length > 0 && (
            <section className={styles.clusters}>
              <small>实验候选颜色组</small>
              {clusters.map(([cluster, item]) => (
                <button
                  data-active={activeCluster === cluster}
                  key={cluster}
                  type="button"
                  onClick={() => selectCluster(cluster)}
                >
                  <i style={{ background: item.color }} />
                  {clusterLabel(cluster)}
                  <span>{item.count}</span>
                </button>
              ))}
            </section>
          )}
          {workflow === 'CREATE' && showCreateRoute && (
            <form className={styles.routeCreator} onSubmit={(event) => void createRoute(event)}>
              <div>
                <strong>线路信息</strong>
                <button type="button" onClick={() => setShowCreateRoute(false)}>
                  返回视觉确认
                </button>
              </div>
              <label>
                线路名称
                <input
                  required
                  maxLength={80}
                  value={newRoute.name}
                  placeholder="例如 黄色测试线"
                  onChange={(event) => setNewRoute({ ...newRoute, name: event.target.value })}
                />
              </label>
              <div className={styles.routeCreatorGrid}>
                <label>
                  颜色
                  <select
                    value={newRoute.color}
                    onChange={(event) =>
                      setNewRoute({ ...newRoute, color: event.target.value as ClimbingColor })
                    }
                  >
                    {climbingColorOptions.map((item) => (
                      <option key={item.value} value={item.value}>
                        {item.label}
                      </option>
                    ))}
                  </select>
                </label>
                <label>
                  难度
                  <input
                    required
                    maxLength={32}
                    value={newRoute.grade}
                    onChange={(event) => setNewRoute({ ...newRoute, grade: event.target.value })}
                  />
                </label>
              </div>
              <label>
                评级体系
                <input
                  required
                  maxLength={32}
                  value={newRoute.gradeSystem}
                  onChange={(event) =>
                    setNewRoute({ ...newRoute, gradeSystem: event.target.value })
                  }
                />
              </label>
              <label>
                风格标签
                <input
                  maxLength={120}
                  value={newRoute.styleTags}
                  placeholder="平衡，脚法，动态"
                  onChange={(event) => setNewRoute({ ...newRoute, styleTags: event.target.value })}
                />
              </label>
              <label>
                所在墙段
                <select
                  required
                  value={newRoute.wallSegmentId}
                  onChange={(event) =>
                    setNewRoute({ ...newRoute, wallSegmentId: event.target.value })
                  }
                >
                  <option value="">请选择墙段</option>
                  {workspace?.wallSegments.map((wall) => (
                    <option key={wall.id} value={wall.id}>
                      {wall.code} · {wall.name}
                    </option>
                  ))}
                </select>
              </label>
              {createError && <p>{createError}</p>}
              <button disabled={busy} type="submit">
                {busy ? '正在保存线路、视觉定义和图片…' : '创建线路'}
              </button>
            </form>
          )}
          {!showCreateRoute && (
            <ol className={styles.instructions}>
              <li>选择“添加岩点”，紧框单块岩点；SAM 首次加载后可连续标注。</li>
              <li>再次点击已有轮廓可取消或恢复选择，无需刷新重来。</li>
              <li>切换“起点”“终点”后点击对应岩点；再次点击可取消标记。</li>
              <li>错误轮廓可直接删除；拆分轮廓和实验批量候选位于“高级修正”。</li>
            </ol>
          )}
          {workflow === 'CREATE' && !showCreateRoute && (
            <button
              className={styles.save}
              disabled={busy}
              type="button"
              onClick={openRouteCreator}
            >
              下一步：填写线路信息
            </button>
          )}
          {workflow === 'BIND' && (
            <button
              className={styles.save}
              disabled={busy || !route || !wallSegmentId}
              type="button"
              onClick={() => void save()}
            >
              {busy ? '处理中…' : '保存已有线路视觉定义'}
            </button>
          )}
        </aside>
      </div>
    </section>
  );
}

function normalizedPoint(event: ReactPointerEvent<SVGSVGElement>) {
  const bounds = event.currentTarget.getBoundingClientRect();
  return {
    x: Math.max(0, Math.min(1, (event.clientX - bounds.left) / bounds.width)),
    y: Math.max(0, Math.min(1, (event.clientY - bounds.top) / bounds.height)),
  };
}

function rectFromPoints(start: { x: number; y: number }, end: { x: number; y: number }) {
  return {
    x1: Math.min(start.x, end.x),
    y1: Math.min(start.y, end.y),
    x2: Math.max(start.x, end.x),
    y2: Math.max(start.y, end.y),
  };
}

function insideRoi(point: { x: number; y: number }, roi: CameraRoi) {
  return point.x >= roi.x1 && point.x <= roi.x2 && point.y >= roi.y1 && point.y <= roi.y2;
}

function modeLabel(mode: EditMode) {
  if (mode === 'PROMPT') return '添加岩点';
  if (mode === 'ROI') return '限制批量区域';
  if (mode === 'MANUAL') return '手动补点';
  if (mode === 'MERGE') return '合并轮廓';
  if (mode === 'START') return '起点';
  return '终点';
}

function mergeHoldPair(first: CameraRouteHold, second: CameraRouteHold): CameraRouteHold {
  const points = [
    ...(first.polygon ?? ellipsePolygon(first.x, first.y, first.width, first.height)),
    ...(second.polygon ?? ellipsePolygon(second.x, second.y, second.width, second.height)),
  ];
  const polygon = convexHull(points);
  const xs = polygon.map((point) => point.x);
  const ys = polygon.map((point) => point.y);
  const minX = Math.min(...xs);
  const maxX = Math.max(...xs);
  const minY = Math.min(...ys);
  const maxY = Math.max(...ys);
  const firstColor = Number.parseInt(first.colorHex.slice(1), 16);
  const secondColor = Number.parseInt(second.colorHex.slice(1), 16);
  const average = [16, 8, 0].map((shift) =>
    Math.round((((firstColor >> shift) & 255) + ((secondColor >> shift) & 255)) / 2),
  );
  return {
    id: `merge-${Date.now()}-${Math.round(((minX + maxX) / 2) * 1000)}`,
    x: (minX + maxX) / 2,
    y: (minY + maxY) / 2,
    width: Math.max(0.002, maxX - minX),
    height: Math.max(0.002, maxY - minY),
    polygon,
    colorHex:
      `#${average.map((value) => value.toString(16).padStart(2, '0')).join('')}`.toUpperCase(),
    colorCluster: first.colorCluster === second.colorCluster ? first.colorCluster : 'prompt',
    confidence: Math.min(first.confidence ?? 1, second.confidence ?? 1),
    source: 'MANUAL',
    modelVersion: 'manual-convex-merge-v1',
  };
}

function convexHull(points: Array<{ x: number; y: number }>) {
  const sorted = [...points].sort((left, right) => left.x - right.x || left.y - right.y);
  if (sorted.length <= 3) return sorted;
  const cross = (
    origin: { x: number; y: number },
    first: { x: number; y: number },
    second: { x: number; y: number },
  ) => (first.x - origin.x) * (second.y - origin.y) - (first.y - origin.y) * (second.x - origin.x);
  const lower: typeof sorted = [];
  for (const point of sorted) {
    while (lower.length >= 2 && cross(lower.at(-2)!, lower.at(-1)!, point) <= 0) lower.pop();
    lower.push(point);
  }
  const upper: typeof sorted = [];
  for (const point of [...sorted].reverse()) {
    while (upper.length >= 2 && cross(upper.at(-2)!, upper.at(-1)!, point) <= 0) upper.pop();
    upper.push(point);
  }
  return [...lower.slice(0, -1), ...upper.slice(0, -1)];
}

function clusterLabel(cluster: string) {
  if (cluster === 'dark') return '黑色';
  if (cluster === 'bright') return '浅色';
  if (cluster === 'manual') return '手动';
  if (cluster === 'prompt') return 'SAM 精确';
  return `色组 ${Number(cluster.replace('hue-', '')) + 1}`;
}

function promptBoxAround(
  point: { x: number; y: number },
  imageSize: { width: number; height: number },
) {
  const halfWidth = Math.min(0.12, 70 / Math.max(1, imageSize.width));
  const halfHeight = Math.min(0.16, 70 / Math.max(1, imageSize.height));
  return {
    x1: Math.max(0, point.x - halfWidth),
    y1: Math.max(0, point.y - halfHeight),
    x2: Math.min(1, point.x + halfWidth),
    y2: Math.min(1, point.y + halfHeight),
  };
}

function pointInsideHoldBounds(point: { x: number; y: number }, hold: CameraRouteHold) {
  return (
    point.x >= hold.x - hold.width / 2 &&
    point.x <= hold.x + hold.width / 2 &&
    point.y >= hold.y - hold.height / 2 &&
    point.y <= hold.y + hold.height / 2
  );
}

function suggestedClimbingColor(holds: CameraRouteHold[]): ClimbingColor {
  const rgb = holds.reduce(
    (sum, hold) => {
      const value = Number.parseInt(hold.colorHex.slice(1), 16);
      return {
        r: sum.r + ((value >> 16) & 255),
        g: sum.g + ((value >> 8) & 255),
        b: sum.b + (value & 255),
      };
    },
    { r: 0, g: 0, b: 0 },
  );
  const count = Math.max(1, holds.length);
  const average = { r: rgb.r / count, g: rgb.g / count, b: rgb.b / count };
  return climbingColorOptions.reduce(
    (closest, option) => {
      const value = Number.parseInt(option.css.slice(1), 16);
      const candidate = { r: (value >> 16) & 255, g: (value >> 8) & 255, b: value & 255 };
      const distance =
        (candidate.r - average.r) ** 2 +
        (candidate.g - average.g) ** 2 +
        (candidate.b - average.b) ** 2;
      return distance < closest.distance ? { color: option.value, distance } : closest;
    },
    { color: 'YELLOW' as ClimbingColor, distance: Number.POSITIVE_INFINITY },
  ).color;
}

async function createAnnotatedRoutePhoto(
  image: HTMLImageElement,
  roi: CameraRoi,
  holds: CameraRouteHold[],
  startIds: string[],
  finishIds: string[],
) {
  const sourceX = Math.round(roi.x1 * image.naturalWidth);
  const sourceY = Math.round(roi.y1 * image.naturalHeight);
  const sourceWidth = Math.max(1, Math.round((roi.x2 - roi.x1) * image.naturalWidth));
  const sourceHeight = Math.max(1, Math.round((roi.y2 - roi.y1) * image.naturalHeight));
  const canvas = document.createElement('canvas');
  canvas.width = sourceWidth;
  canvas.height = sourceHeight;
  const context = canvas.getContext('2d');
  if (!context) throw new Error('浏览器无法生成线路图片');
  context.drawImage(
    image,
    sourceX,
    sourceY,
    sourceWidth,
    sourceHeight,
    0,
    0,
    sourceWidth,
    sourceHeight,
  );
  for (const hold of holds) {
    const x = hold.x * image.naturalWidth - sourceX;
    const y = hold.y * image.naturalHeight - sourceY;
    const radiusX = Math.max(5, (hold.width * image.naturalWidth) / 2);
    const radiusY = Math.max(5, (hold.height * image.naturalHeight) / 2);
    const role = startIds.includes(hold.id) ? 'S' : finishIds.includes(hold.id) ? 'F' : '';
    context.beginPath();
    if (hold.polygon?.length) {
      hold.polygon.forEach((point, index) => {
        const polygonX = point.x * image.naturalWidth - sourceX;
        const polygonY = point.y * image.naturalHeight - sourceY;
        if (index === 0) context.moveTo(polygonX, polygonY);
        else context.lineTo(polygonX, polygonY);
      });
      context.closePath();
    } else {
      context.ellipse(x, y, radiusX, radiusY, 0, 0, Math.PI * 2);
    }
    context.lineWidth = Math.max(3, sourceWidth / 320);
    context.strokeStyle = role === 'S' ? '#FFC441' : role === 'F' ? '#3EE592' : '#DCF56D';
    context.stroke();
    if (role) {
      context.fillStyle = role === 'S' ? '#FFC441' : '#3EE592';
      context.font = `900 ${Math.max(18, sourceWidth / 28)}px sans-serif`;
      context.textAlign = 'center';
      context.textBaseline = 'middle';
      context.fillText(role, x, y);
    }
  }
  const blob = await new Promise<Blob | null>((resolve) =>
    canvas.toBlob(resolve, 'image/webp', 0.9),
  );
  if (!blob) throw new Error('线路图片生成失败');
  return new File([blob], `route-visual-${Date.now()}.webp`, { type: 'image/webp' });
}

function holdPath(hold: CameraRouteHold) {
  const rings = [hold.polygon, ...(hold.holes ?? [])].filter(
    (ring): ring is NonNullable<CameraRouteHold['polygon']> => Boolean(ring?.length),
  );
  return rings
    .map(
      (ring) =>
        `${ring
          .map((point, index) => `${index === 0 ? 'M' : 'L'} ${point.x * 1000} ${point.y * 1000}`)
          .join(' ')} Z`,
    )
    .join(' ');
}

function ellipsePolygon(x: number, y: number, width: number, height: number) {
  return Array.from({ length: 20 }, (_, index) => {
    const angle = (index / 20) * Math.PI * 2;
    return {
      x: Math.max(0, Math.min(1, x + (Math.cos(angle) * width) / 2)),
      y: Math.max(0, Math.min(1, y + (Math.sin(angle) * height) / 2)),
    };
  });
}

function statusLabel(status: CameraRouteWorkspace['routes'][number]['status']) {
  return (
    {
      DRAFT: '草稿',
      READY_FOR_INSTALL: '待施工',
      PUBLISHED: '正常',
      INACTIVE: '已停用',
    } as const
  )[status];
}

function formatSnapshotTime(value: string | null) {
  if (!value) return '稍早';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '稍早';
  return new Intl.DateTimeFormat('zh-CN', {
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  }).format(date);
}
