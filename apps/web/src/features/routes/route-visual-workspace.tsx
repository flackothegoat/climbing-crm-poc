'use client';

import { useEffect, useMemo, useState } from 'react';
import { climbingColorCss } from '../common/climbing-colors';
import {
  confirmRouteVisual,
  getRouteVisualWorkspace,
  saveRouteVisualDraft,
  type OperationalRoute,
  type RouteVisualPoint,
  type RouteVisualWorkspaceData,
} from './route-operations-api';
import { RouteVisualScene } from './route-visual-scene';
import { RouteVisualTopo } from './route-visual-topo';
import styles from './route-visual.module.css';

type ViewMode = 'MODEL' | 'TOPO' | 'CAMERA';

export function RouteVisualWorkspace({
  initialRoute,
  onClose,
  onConfirmed,
}: {
  initialRoute: OperationalRoute;
  onClose: () => void;
  onConfirmed: () => Promise<void>;
}) {
  const [data, setData] = useState<RouteVisualWorkspaceData | null>(null);
  const [points, setPoints] = useState<RouteVisualPoint[]>([]);
  const [mode, setMode] = useState<ViewMode>('MODEL');
  const [editing, setEditing] = useState(false);
  const [working, setWorking] = useState(false);
  const [message, setMessage] = useState('');

  useEffect(() => {
    getRouteVisualWorkspace(initialRoute.id)
      .then((workspace) => {
        setData(workspace);
        setPoints((workspace.draft ?? workspace.confirmed)?.points ?? []);
      })
      .catch((error: unknown) =>
        setMessage(error instanceof Error ? error.message : '视觉标注加载失败'),
      );
  }, [initialRoute.id]);

  const title = data?.route ?? initialRoute;
  const segments = data?.wallSegments ?? initialRoute.wallSegments;
  const location = useMemo(() => {
    const area = data?.wallSegments[0]?.area;
    return [area?.floorLabel, area?.name, segments.map((item) => item.code).join(' → ')]
      .filter(Boolean)
      .join(' · ');
  }, [data, segments]);

  function addPoint(point: Omit<RouteVisualPoint, 'role'>) {
    if (!editing) return;
    setPoints((current) => {
      if (current.some((item) => item.role === 'FINISH')) return current;
      return [...current, { ...point, role: current.length ? 'NORMAL' : 'START' }];
    });
  }

  async function save() {
    if (points.length < 2 || points.at(-1)?.role !== 'FINISH') {
      setMessage('请至少标记起点和终点，并将最后一个点设为终点。');
      return;
    }
    setWorking(true);
    try {
      const workspace = await saveRouteVisualDraft(initialRoute.id, points);
      setData(workspace);
      setPoints(workspace.draft?.points ?? points);
      setEditing(false);
      setMessage('视觉标注草稿已保存，确认后才会用于正式展示。');
    } catch (error) {
      setMessage(error instanceof Error ? error.message : '视觉标注保存失败');
    } finally {
      setWorking(false);
    }
  }

  async function confirm() {
    if (!window.confirm('确认后，该修订将成为这条线路当前正式的视觉展示。继续？')) return;
    setWorking(true);
    try {
      const workspace = await confirmRouteVisual(initialRoute.id);
      setData(workspace);
      setPoints(workspace.confirmed?.points ?? []);
      setEditing(false);
      setMessage('视觉标注已确认，并同步到线路展示与会员二维码页。');
      await onConfirmed();
    } catch (error) {
      setMessage(error instanceof Error ? error.message : '视觉标注确认失败');
    } finally {
      setWorking(false);
    }
  }

  function markFinish() {
    setPoints((current) =>
      current.length < 2
        ? current
        : current.map((point, index) => ({
            ...point,
            role: index === 0 ? 'START' : index === current.length - 1 ? 'FINISH' : 'NORMAL',
          })),
    );
  }

  return (
    <section className={styles.workspace}>
      <header className={styles.workspaceHeader}>
        <div className={styles.routeTitle}>
          <span style={{ background: climbingColorCss(title.color) }} />
          <div>
            <small>线路视觉定位 · {location || '墙段位置待补充'}</small>
            <h2>
              {title.code} · {title.name}
            </h2>
            <p>
              {title.grade} · {points.length} 个视觉点 · 版本 {data?.version.number ?? '—'}
            </p>
          </div>
        </div>
        <button className={styles.closeButton} type="button" onClick={onClose}>
          关闭
        </button>
      </header>
      <div className={styles.workspaceBody}>
        <div className={styles.visualColumn}>
          <div className={styles.viewTabs}>
            <button aria-pressed={mode === 'MODEL'} type="button" onClick={() => setMode('MODEL')}>
              3D 扫描模型
            </button>
            <button aria-pressed={mode === 'TOPO'} type="button" onClick={() => setMode('TOPO')}>
              正立面线路图
            </button>
            <button
              aria-pressed={mode === 'CAMERA'}
              type="button"
              onClick={() => setMode('CAMERA')}
            >
              现场画面
            </button>
          </div>
          {mode === 'MODEL' && (
            <RouteVisualScene
              color={title.color}
              editable={editing}
              onAddPoint={addPoint}
              points={points}
              segments={segments}
            />
          )}
          {mode === 'TOPO' && (
            <RouteVisualTopo
              color={climbingColorCss(title.color)}
              editable={editing}
              onAddPoint={addPoint}
              points={points}
              segments={segments}
            />
          )}
          {mode === 'CAMERA' && <CameraPanel segments={segments.map((item) => item.code)} />}
        </div>
        <aside className={styles.inspector}>
          <div>
            <small>当前状态</small>
            <strong>
              {data?.draft ? '有待确认草稿' : data?.confirmed ? '已正式确认' : '尚未标注'}
            </strong>
            <p>正式展示只读取已确认修订；编辑过程中不会污染线上线路。</p>
          </div>
          <div>
            <small>标注顺序</small>
            <ol className={styles.pointList}>
              {points.map((point, index) => (
                <li key={`${point.wallSegmentId}-${index}`}>
                  <span>
                    {point.role === 'START' ? '起' : point.role === 'FINISH' ? '终' : index + 1}
                  </span>
                  <div>
                    <strong>
                      {segments.find((item) => item.id === point.wallSegmentId)?.code}
                    </strong>
                    <small>
                      {Math.round(point.uNormalized * 100)}%, {Math.round(point.vNormalized * 100)}%
                    </small>
                  </div>
                </li>
              ))}
            </ol>
          </div>
          {message && <p className={styles.message}>{message}</p>}
          <div className={styles.workspaceActions}>
            {!editing ? (
              <button type="button" onClick={() => setEditing(true)}>
                编辑视觉点
              </button>
            ) : (
              <>
                <button
                  disabled={!points.length}
                  type="button"
                  onClick={() => setPoints((current) => current.slice(0, -1))}
                >
                  撤销一点
                </button>
                <button disabled={points.length < 2} type="button" onClick={markFinish}>
                  将末点设为终点
                </button>
                <button disabled={working} type="button" onClick={() => void save()}>
                  保存草稿
                </button>
              </>
            )}
            {data?.draft && !editing && (
              <button
                className={styles.confirmButton}
                disabled={working}
                type="button"
                onClick={() => void confirm()}
              >
                确认正式标注
              </button>
            )}
          </div>
        </aside>
      </div>
    </section>
  );
}

function CameraPanel({ segments }: { segments: string[] }) {
  return (
    <div className={styles.cameraPanel}>
      <span>LIVE</span>
      <strong>尚未绑定现场摄像头</strong>
      <p>
        TL-IPC48AN 的公网推流链路已跑通；岩馆实测后，可把设备与 {segments.join(' / ')}{' '}
        的观察区域绑定。此处不会用演示视频冒充实时分析。
      </p>
      <dl>
        <div>
          <dt>视频状态</dt>
          <dd>等待现场验证</dd>
        </div>
        <div>
          <dt>算法状态</dt>
          <dd>未启用</dd>
        </div>
        <div>
          <dt>数据来源</dt>
          <dd>二维码反馈</dd>
        </div>
      </dl>
    </div>
  );
}
