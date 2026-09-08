'use client';

import Image from 'next/image';
import QRCode from 'qrcode';
import { useEffect, useMemo, useState, type FormEvent } from 'react';
import { PageHeading, SectionCard, StatGrid, StatusBadge } from '../dashboard/page-components';
import {
  climbingColorCss,
  climbingColorLabel,
  climbingColorOptions,
  type ClimbingColor,
} from '../common/climbing-colors';
import {
  createOperationalWall,
  deleteOperationalRoute,
  getOperationalRoutes,
  getRouteContext,
  publishOperationalRoute,
  retireOperationalRoute,
  restoreOperationalRoute,
  routePhotoUrl,
  updateOperationalRoute,
  uploadRoutePhoto,
  type OperationalRoute,
  type RouteContext,
  type RouteInput,
} from './route-operations-api';
import styles from './routes.module.css';
import { RouteAnalyticsPage } from './route-analytics-page';

export function RouteOperationsPage() {
  const [routes, setRoutes] = useState<OperationalRoute[]>([]);
  const [context, setContext] = useState<RouteContext>({ areas: [], setters: [] });
  const [loading, setLoading] = useState(true);
  const [message, setMessage] = useState('');
  const [showForm, setShowForm] = useState(false);
  const [editing, setEditing] = useState<OperationalRoute | null>(null);
  const [qrRoute, setQrRoute] = useState<OperationalRoute | null>(null);
  const [analyticsRoute, setAnalyticsRoute] = useState<OperationalRoute | null>(null);
  const [routeQuery, setRouteQuery] = useState('');
  const [statusFilter, setStatusFilter] = useState<'ALL' | 'PUBLISHED' | 'INACTIVE'>('ALL');

  async function refresh() {
    setLoading(true);
    try {
      const [nextRoutes, nextContext] = await Promise.all([
        getOperationalRoutes(),
        getRouteContext(),
      ]);
      setRoutes(nextRoutes);
      setContext(nextContext);
      setMessage('');
    } catch (error) {
      setMessage(error instanceof Error ? error.message : '线路运营数据加载失败');
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => void refresh(), []);

  const active = routes.filter((route) => route.status === 'PUBLISHED').length;
  const inactive = routes.filter((route) => route.status === 'INACTIVE').length;
  const feedback = routes.reduce((sum, route) => sum + route.feedbackCount, 0);
  const visibleRoutes = useMemo(() => {
    const query = routeQuery.trim().toLowerCase();
    return routes.filter(
      (route) =>
        (statusFilter === 'ALL' || route.status === statusFilter) &&
        (!query ||
          [route.code, route.name, route.grade, climbingColorLabel(route.color)].some((value) =>
            value.toLowerCase().includes(query),
          )),
    );
  }, [routeQuery, routes, statusFilter]);

  function edit(route: OperationalRoute) {
    setEditing(route);
    setShowForm(true);
  }

  if (analyticsRoute)
    return <RouteAnalyticsPage route={analyticsRoute} onBack={() => setAnalyticsRoute(null)} />;

  return (
    <div className="page-stack">
      <PageHeading
        eyebrow="第一阶段 · 线路数字化"
        title="线路库"
        description="浏览、查询和维护从真实墙面视觉配置创建的线路。"
      />
      <StatGrid
        items={[
          { label: '正常线路', value: String(active), detail: 'Worker 当前可用', tone: 'accent' },
          { label: '已停用线路', value: String(inactive), detail: '可恢复或删除' },
          { label: '二维码反馈', value: String(feedback), detail: '主动反馈样本，不等于真实客流' },
          {
            label: '墙段档案',
            value: String(context.areas.flatMap((area) => area.segments).length),
            detail: '可支持跨相邻墙段',
          },
        ]}
      />
      {message && <p className="team-feedback is-error">{message}</p>}
      {showForm && editing && (
        <RouteEditor
          context={context}
          initial={editing}
          onCancel={() => setShowForm(false)}
          onSaved={async () => {
            setShowForm(false);
            await refresh();
          }}
          onWallCreated={refresh}
        />
      )}
      <SectionCard
        title="线路档案"
        description="颜色只用于识别；线路编号和发布版本才是数据归属依据。"
      >
        <div className={styles.catalogTools}>
          <input
            value={routeQuery}
            placeholder="搜索编号、名称、难度或颜色"
            onChange={(event) => setRouteQuery(event.target.value)}
          />
          <select
            value={statusFilter}
            onChange={(event) =>
              setStatusFilter(event.target.value as 'ALL' | 'PUBLISHED' | 'INACTIVE')
            }
          >
            <option value="ALL">全部状态</option>
            <option value="PUBLISHED">正常</option>
            <option value="INACTIVE">已停用</option>
          </select>
        </div>
        {loading ? (
          <p className={styles.empty}>正在读取线路…</p>
        ) : visibleRoutes.length ? (
          <div className={styles.routeGrid}>
            {visibleRoutes.map((route) => (
              <RouteCard
                key={route.id}
                route={route}
                onEdit={() => edit(route)}
                onQr={() => setQrRoute(route)}
                onAnalytics={() => setAnalyticsRoute(route)}
                onChanged={refresh}
                onError={setMessage}
              />
            ))}
          </div>
        ) : routes.length ? (
          <div className={styles.emptyState}>
            <strong>没有匹配的线路</strong>
            <p>请调整搜索条件或状态筛选。</p>
          </div>
        ) : (
          <div className={styles.emptyState}>
            <strong>还没有线路档案</strong>
            <p>请前往“视频识别”，根据真实墙面完成视觉标注并创建线路。</p>
          </div>
        )}
      </SectionCard>
      {qrRoute?.publicToken && <QrDialog route={qrRoute} onClose={() => setQrRoute(null)} />}
    </div>
  );
}

function RouteCard({
  route,
  onEdit,
  onQr,
  onAnalytics,
  onChanged,
  onError,
}: {
  route: OperationalRoute;
  onEdit: () => void;
  onQr: () => void;
  onAnalytics: () => void;
  onChanged: () => Promise<void>;
  onError: (message: string) => void;
}) {
  const [working, setWorking] = useState(false);

  async function action(kind: 'publish' | 'retire' | 'restore' | 'delete') {
    if (
      !window.confirm(
        kind === 'publish'
          ? '发布后将生成会员二维码，线路元数据将作为当前版本快照。确认发布？'
          : kind === 'retire'
            ? '停用后 Worker 和会员反馈将停止使用该线路，历史数据仍会保留。确认停用？'
            : kind === 'restore'
              ? '恢复后 Worker 将重新使用该线路。确认恢复？'
              : '删除后该线路将从线路库和摄像头配置中隐藏，历史关联仍会保留。确认删除？',
      )
    )
      return;
    setWorking(true);
    try {
      if (kind === 'publish') await publishOperationalRoute(route.id);
      else if (kind === 'retire') await retireOperationalRoute(route.id);
      else if (kind === 'restore') await restoreOperationalRoute(route.id);
      else await deleteOperationalRoute(route.id);
      await onChanged();
    } catch (error) {
      onError(error instanceof Error ? error.message : '线路状态变更失败');
    } finally {
      setWorking(false);
    }
  }

  return (
    <article className={styles.routeCard}>
      {route.version?.hasPhoto && <RoutePhotoPreview route={route} />}
      <div className={styles.routeIdentity}>
        <span
          className={styles.routeColor}
          style={{ background: climbingColorCss(route.color) }}
          title={climbingColorLabel(route.color)}
        />
        <div>
          <p>{route.code}</p>
          <h4>{route.name}</h4>
        </div>
        <StatusBadge value={statusLabel(route.status)} />
      </div>
      <dl className={styles.routeFacts}>
        <div>
          <dt>难度</dt>
          <dd>
            {route.gradeSystem ? `${route.gradeSystem} · ` : ''}
            {route.grade}
          </dd>
        </div>
        <div>
          <dt>墙段</dt>
          <dd>{route.wallSegments.map((wall) => wall.code).join(' / ') || '未关联'}</dd>
        </div>
        <div>
          <dt>定线员</dt>
          <dd>{route.setter ? (route.setter.displayName ?? '未命名员工') : '未填写'}</dd>
        </div>
        <div>
          <dt>反馈样本</dt>
          <dd>{route.feedbackCount}</dd>
        </div>
      </dl>
      {route.styleTags.length > 0 && (
        <div className={styles.tags}>
          {route.styleTags.map((tag) => (
            <span key={tag}>{tag}</span>
          ))}
        </div>
      )}
      <p className={styles.routeDate}>
        {route.status === 'PUBLISHED'
          ? `上线于 ${formatDate(route.publishedAt)}`
          : route.status === 'INACTIVE'
            ? `停用于 ${formatDate(route.retiredAt)}`
            : route.status === 'REMOVED'
              ? `删除于 ${formatDate(route.retiredAt)}`
              : `更新于 ${formatDate(route.updatedAt)}`}
      </p>
      <div className={styles.cardActions}>
        <button type="button" onClick={onAnalytics}>
          反馈与复盘
        </button>
        {route.actions.canEdit && (
          <button type="button" onClick={onEdit}>
            编辑信息
          </button>
        )}
        {route.actions.canPublish && (
          <button disabled={working} type="button" onClick={() => action('publish')}>
            发布并生成二维码
          </button>
        )}
        {route.publicToken && (
          <button type="button" onClick={onQr}>
            查看二维码
          </button>
        )}
        {route.actions.canRetire && (
          <button
            className={styles.dangerButton}
            disabled={working}
            type="button"
            onClick={() => action('retire')}
          >
            停用线路
          </button>
        )}
        {route.actions.canRestore && (
          <button disabled={working} type="button" onClick={() => action('restore')}>
            恢复线路
          </button>
        )}
        {route.status === 'PUBLISHED' && (
          <button
            className={styles.dangerButton}
            disabled
            title="只有已停用的线路才能删除"
            type="button"
          >
            删除线路
          </button>
        )}
        {route.actions.canDelete && (
          <button
            className={styles.dangerButton}
            disabled={working}
            type="button"
            onClick={() => action('delete')}
          >
            删除线路
          </button>
        )}
      </div>
    </article>
  );
}

function RoutePhotoPreview({ route }: { route: OperationalRoute }) {
  const [open, setOpen] = useState(false);
  const photoUrl = routePhotoUrl(route.id);

  useEffect(() => {
    if (!open) return;
    function closeOnEscape(event: KeyboardEvent) {
      if (event.key === 'Escape') setOpen(false);
    }
    window.addEventListener('keydown', closeOnEscape);
    return () => window.removeEventListener('keydown', closeOnEscape);
  }, [open]);

  return (
    <>
      <div className={styles.routePhotoFrame}>
        <button
          aria-haspopup="dialog"
          aria-label={`查看 ${route.name} 的完整线路截图`}
          className={styles.routePhotoButton}
          type="button"
          onClick={() => setOpen(true)}
        >
          {/* Authenticated same-origin image; the browser sends the session cookie. */}
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img className={styles.routePhoto} src={photoUrl} alt={`${route.name} 线路`} />
          <span className={styles.routePhotoHint}>查看完整截图</span>
        </button>
      </div>
      {open && (
        <div
          className={styles.dialogBackdrop}
          role="presentation"
          onMouseDown={(event) => {
            if (event.target === event.currentTarget) setOpen(false);
          }}
        >
          <section
            aria-label={`${route.name} 完整线路截图`}
            aria-modal="true"
            className={styles.photoDialog}
            role="dialog"
          >
            <button
              aria-label="关闭完整线路截图"
              className={styles.dialogClose}
              type="button"
              onClick={() => setOpen(false)}
            >
              ×
            </button>
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              className={styles.routePhotoFull}
              src={photoUrl}
              alt={`${route.name} 完整线路截图`}
            />
            <p>
              {route.code} · {route.name}
            </p>
          </section>
        </div>
      )}
    </>
  );
}

function RouteEditor({
  context,
  initial,
  onCancel,
  onSaved,
  onWallCreated,
}: {
  context: RouteContext;
  initial: OperationalRoute;
  onCancel: () => void;
  onSaved: () => Promise<void>;
  onWallCreated: () => Promise<void>;
}) {
  const [form, setForm] = useState<RouteInput>(() => ({
    code: initial.code,
    name: initial.name,
    description: initial.description ?? '',
    color: initial.color,
    grade: initial.grade,
    gradeSystem: initial.gradeSystem ?? 'V',
    styleTags: initial.styleTags,
    setterMembershipId: initial.setter?.id ?? null,
    wallSegmentIds: initial.wallSegments.map((wall) => wall.id),
    expectedRetireAt: initial.expectedRetireAt,
  }));
  const [tagText, setTagText] = useState(form.styleTags.join('，'));
  const [photo, setPhoto] = useState<File | null>(null);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [showWall, setShowWall] = useState(
    context.areas.flatMap((area) => area.segments).length === 0,
  );

  async function submit(event: FormEvent) {
    event.preventDefault();
    setSaving(true);
    setError('');
    const input = {
      ...form,
      styleTags: tagText
        .split(/[，,]/)
        .map((tag) => tag.trim())
        .filter(Boolean),
      expectedRetireAt: form.expectedRetireAt
        ? new Date(`${form.expectedRetireAt}T12:00:00+08:00`).toISOString()
        : null,
    };
    try {
      const route = await updateOperationalRoute(initial.id, input);
      if (photo) await uploadRoutePhoto(route.id, photo);
      await onSaved();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : '线路保存失败');
    } finally {
      setSaving(false);
    }
  }

  const segments = context.areas.flatMap((area) =>
    area.segments.map((segment) => ({ ...segment, areaName: area.name })),
  );

  return (
    <SectionCard
      title={`编辑线路 ${initial.code}`}
      description="线路编号由系统生成；修改颜色、难度或墙段时请确认视觉定义仍然有效。"
    >
      <form className={styles.editor} onSubmit={submit}>
        <div className={styles.formGrid}>
          <label>
            线路编号
            <input
              required
              disabled
              maxLength={64}
              value={form.code}
              placeholder="例如 R-027"
              onChange={(event) => setForm({ ...form, code: event.target.value })}
            />
          </label>
          <label>
            线路名称
            <input
              required
              maxLength={80}
              value={form.name}
              placeholder="例如 晨雾"
              onChange={(event) => setForm({ ...form, name: event.target.value })}
            />
          </label>
          <label>
            预计难度
            <input
              required
              maxLength={32}
              value={form.grade}
              placeholder="V3"
              onChange={(event) => setForm({ ...form, grade: event.target.value })}
            />
          </label>
          <label>
            评级体系
            <input
              required
              maxLength={32}
              value={form.gradeSystem}
              placeholder="V / 法式 / YDS"
              onChange={(event) => setForm({ ...form, gradeSystem: event.target.value })}
            />
          </label>
          <label>
            线路颜色
            <select
              value={form.color}
              onChange={(event) => setForm({ ...form, color: event.target.value as ClimbingColor })}
            >
              {climbingColorOptions.map(({ value, label }) => (
                <option key={value} value={value}>
                  {label}
                </option>
              ))}
            </select>
          </label>
          <label>
            主要定线员
            <select
              value={form.setterMembershipId ?? ''}
              onChange={(event) =>
                setForm({ ...form, setterMembershipId: event.target.value || null })
              }
            >
              <option value="">暂不填写</option>
              {context.setters.map((setter) => (
                <option key={setter.id} value={setter.id}>
                  {setter.displayName ?? '未命名员工'}
                  {setter.jobTitle ? ` · ${setter.jobTitle}` : ''}
                </option>
              ))}
            </select>
          </label>
          <label>
            风格标签
            <input
              value={tagText}
              placeholder="平衡，脚法，动态"
              onChange={(event) => setTagText(event.target.value)}
            />
          </label>
          <label>
            预计拆线日期
            <input
              type="date"
              value={form.expectedRetireAt?.slice(0, 10) ?? ''}
              onChange={(event) =>
                setForm({ ...form, expectedRetireAt: event.target.value || null })
              }
            />
          </label>
        </div>
        <fieldset className={styles.wallChoices}>
          <legend>所在墙段（可多选）</legend>
          {segments.length ? (
            segments.map((segment) => (
              <label key={segment.id}>
                <input
                  type="checkbox"
                  checked={form.wallSegmentIds.includes(segment.id)}
                  onChange={(event) =>
                    setForm({
                      ...form,
                      wallSegmentIds: event.target.checked
                        ? [...form.wallSegmentIds, segment.id]
                        : form.wallSegmentIds.filter((id) => id !== segment.id),
                    })
                  }
                />
                <span>
                  <strong>{segment.code}</strong>
                  {segment.areaName} · {segment.name}
                </span>
              </label>
            ))
          ) : (
            <p>还没有墙段，请先建立轻量墙段档案。</p>
          )}
          <button
            className={styles.textButton}
            type="button"
            onClick={() => setShowWall((value) => !value)}
          >
            {showWall ? '收起墙段创建' : '新增墙段'}
          </button>
        </fieldset>
        {showWall && <WallCreator onCreated={onWallCreated} />}
        <label>
          线路说明
          <textarea
            maxLength={500}
            value={form.description ?? ''}
            placeholder="起步说明、风格或运营备注"
            onChange={(event) => setForm({ ...form, description: event.target.value })}
          />
        </label>
        <label>
          线路照片（可在发布前补充）
          <input
            accept="image/jpeg,image/png,image/webp"
            type="file"
            onChange={(event) => setPhoto(event.target.files?.[0] ?? null)}
          />
          <small>支持 JPEG、PNG、WebP，最大 10 MB。照片用于会员确认线路，不要求 GLB。</small>
        </label>
        {error && <p className="team-feedback is-error">{error}</p>}
        <div className={styles.formActions}>
          <button className={styles.secondaryButton} type="button" onClick={onCancel}>
            取消
          </button>
          <button
            className={styles.primaryButton}
            disabled={saving || form.wallSegmentIds.length === 0}
            type="submit"
          >
            {saving ? '保存中…' : '保存线路信息'}
          </button>
        </div>
      </form>
    </SectionCard>
  );
}

function WallCreator({ onCreated }: { onCreated: () => Promise<void> }) {
  const [fields, setFields] = useState({
    areaCode: 'BOULDER',
    areaName: '抱石区',
    floorLabel: '1F',
    segmentCode: '',
    segmentName: '',
  });
  const [message, setMessage] = useState('');
  async function submit() {
    try {
      await createOperationalWall(fields);
      setMessage('墙段已创建，可直接选择。');
      await onCreated();
    } catch (error) {
      setMessage(error instanceof Error ? error.message : '墙段创建失败');
    }
  }
  return (
    <div className={styles.wallCreator}>
      <strong>轻量墙段档案</strong>
      <input
        required
        value={fields.areaCode}
        placeholder="区域编号"
        onChange={(event) => setFields({ ...fields, areaCode: event.target.value })}
      />
      <input
        required
        value={fields.areaName}
        placeholder="区域名称"
        onChange={(event) => setFields({ ...fields, areaName: event.target.value })}
      />
      <input
        required
        value={fields.segmentCode}
        placeholder="墙段编号，如 W01"
        onChange={(event) => setFields({ ...fields, segmentCode: event.target.value })}
      />
      <input
        required
        value={fields.segmentName}
        placeholder="现场名称"
        onChange={(event) => setFields({ ...fields, segmentName: event.target.value })}
      />
      <button type="button" onClick={() => void submit()}>
        创建墙段
      </button>
      {message && <small>{message}</small>}
    </div>
  );
}

function QrDialog({ route, onClose }: { route: OperationalRoute; onClose: () => void }) {
  const [image, setImage] = useState('');
  const [url, setUrl] = useState('');
  useEffect(() => {
    const publicUrl = `${window.location.origin}/r/${route.publicToken}`;
    setUrl(publicUrl);
    void QRCode.toDataURL(publicUrl, { width: 320, margin: 2, errorCorrectionLevel: 'M' }).then(
      setImage,
    );
  }, [route.publicToken]);
  return (
    <div className={styles.dialogBackdrop} role="presentation" onMouseDown={onClose}>
      <section
        className={styles.qrDialog}
        role="dialog"
        aria-modal="true"
        aria-label="线路二维码"
        onMouseDown={(event) => event.stopPropagation()}
      >
        <button className={styles.dialogClose} type="button" onClick={onClose}>
          ×
        </button>
        <div className={styles.printCard}>
          <span className={styles.qrColor} style={{ background: climbingColorCss(route.color) }} />
          <p>扫码反馈</p>
          <h2>
            {route.code} · {route.name}
          </h2>
          <strong>{route.grade}</strong>
          {image && (
            <Image
              unoptimized
              width={320}
              height={320}
              alt={`${route.code} 线路反馈二维码`}
              src={image}
            />
          )}
          <small>{route.wallSegments.map((wall) => wall.code).join(' / ')}</small>
        </div>
        <p className={styles.qrHint}>
          会员无需登录；反馈绑定当前发布版本。完整换线时请创建新线路和新二维码。
        </p>
        <a className={styles.qrUrl} href={url} target="_blank" rel="noreferrer">
          {url}
        </a>
        <div className={styles.formActions}>
          <button
            className={styles.secondaryButton}
            type="button"
            onClick={() => navigator.clipboard.writeText(url)}
          >
            复制链接
          </button>
          <button className={styles.primaryButton} type="button" onClick={() => window.print()}>
            打印二维码
          </button>
        </div>
      </section>
    </div>
  );
}

function statusLabel(status: OperationalRoute['status']) {
  return (
    {
      DRAFT: '草稿',
      READY_FOR_INSTALL: '待施工',
      PUBLISHED: '正常',
      INACTIVE: '已停用',
      REMOVED: '已删除',
    } as const
  )[status];
}

function formatDate(value: string | null) {
  return value
    ? new Intl.DateTimeFormat('zh-CN', { dateStyle: 'medium' }).format(new Date(value))
    : '未记录';
}
