'use client';

import Link from 'next/link';
import Image from 'next/image';
import QRCode from 'qrcode';
import { useEffect, useState, type FormEvent } from 'react';
import { PageHeading, SectionCard, StatGrid, StatusBadge } from '../dashboard/page-components';
import {
  climbingColorCss,
  climbingColorLabel,
  climbingColorOptions,
  type ClimbingColor,
} from '../common/climbing-colors';
import {
  createOperationalRoute,
  createOperationalWall,
  getOperationalRoutes,
  getRouteContext,
  publishOperationalRoute,
  retireOperationalRoute,
  updateOperationalRoute,
  uploadRoutePhoto,
  type OperationalRoute,
  type RouteContext,
  type RouteInput,
} from './route-operations-api';
import styles from './routes.module.css';
import { RouteVisualWorkspace } from './route-visual-workspace';

const emptyForm: RouteInput = {
  code: '',
  name: '',
  description: '',
  color: 'GREEN',
  grade: 'V3',
  gradeSystem: 'V',
  styleTags: [],
  setterMembershipId: null,
  wallSegmentIds: [],
  expectedRetireAt: null,
};

export function RouteOperationsPage() {
  const [routes, setRoutes] = useState<OperationalRoute[]>([]);
  const [context, setContext] = useState<RouteContext>({ areas: [], setters: [] });
  const [loading, setLoading] = useState(true);
  const [message, setMessage] = useState('');
  const [showForm, setShowForm] = useState(false);
  const [editing, setEditing] = useState<OperationalRoute | null>(null);
  const [qrRoute, setQrRoute] = useState<OperationalRoute | null>(null);
  const [visualRoute, setVisualRoute] = useState<OperationalRoute | null>(null);

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
  const drafts = routes.filter((route) => route.status === 'DRAFT').length;
  const feedback = routes.reduce((sum, route) => sum + route.feedbackCount, 0);

  function edit(route: OperationalRoute) {
    setEditing(route);
    setShowForm(true);
  }

  return (
    <div className="page-stack">
      <PageHeading
        eyebrow="第一阶段 · 线路数字化"
        title="线路运营"
        description="先完成线路建档、发布、二维码反馈和复盘；三维定线作为可选实验能力。"
        aside={
          <div className={styles.headingActions}>
            <Link className={styles.secondaryButton} href="/dashboard/assets/routes/setting">
              3D 实验定线
            </Link>
            <button
              className={styles.primaryButton}
              type="button"
              onClick={() => {
                setEditing(null);
                setShowForm(true);
              }}
            >
              新建线路
            </button>
          </div>
        }
      />
      <StatGrid
        items={[
          { label: '已发布线路', value: String(active), detail: '当前可扫码反馈', tone: 'accent' },
          { label: '线路草稿', value: String(drafts), detail: '不占用 3D 或岩点资产' },
          { label: '二维码反馈', value: String(feedback), detail: '主动反馈样本，不等于真实客流' },
          {
            label: '墙段档案',
            value: String(context.areas.flatMap((area) => area.segments).length),
            detail: '可支持跨相邻墙段',
          },
        ]}
      />
      {message && <p className="team-feedback is-error">{message}</p>}
      {showForm && (
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
      {visualRoute && (
        <RouteVisualWorkspace
          initialRoute={visualRoute}
          onClose={() => setVisualRoute(null)}
          onConfirmed={refresh}
        />
      )}
      <SectionCard
        title="线路档案"
        description="颜色只用于识别；线路编号和发布版本才是数据归属依据。"
      >
        {loading ? (
          <p className={styles.empty}>正在读取线路…</p>
        ) : routes.length ? (
          <div className={styles.routeGrid}>
            {routes.map((route) => (
              <RouteCard
                key={route.id}
                route={route}
                onEdit={() => edit(route)}
                onQr={() => setQrRoute(route)}
                onVisual={() => setVisualRoute(route)}
                onChanged={refresh}
                onError={setMessage}
              />
            ))}
          </div>
        ) : (
          <div className={styles.emptyState}>
            <strong>还没有线路档案</strong>
            <p>先建立墙段，再创建第一条真实线路；不需要 GLB、孔位或岩点库存。</p>
            <button
              className={styles.primaryButton}
              type="button"
              onClick={() => setShowForm(true)}
            >
              建立第一条线路
            </button>
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
  onVisual,
  onChanged,
  onError,
}: {
  route: OperationalRoute;
  onEdit: () => void;
  onQr: () => void;
  onVisual: () => void;
  onChanged: () => Promise<void>;
  onError: (message: string) => void;
}) {
  const [working, setWorking] = useState(false);

  async function action(kind: 'publish' | 'retire') {
    if (
      !window.confirm(
        kind === 'publish'
          ? '发布后将生成会员二维码，线路元数据将作为当前版本快照。确认发布？'
          : '下线后二维码将停止接收反馈，历史数据仍会保留。确认下线？',
      )
    )
      return;
    setWorking(true);
    try {
      if (kind === 'publish') await publishOperationalRoute(route.id);
      else await retireOperationalRoute(route.id);
      await onChanged();
    } catch (error) {
      onError(error instanceof Error ? error.message : '线路状态变更失败');
    } finally {
      setWorking(false);
    }
  }

  return (
    <article className={styles.routeCard}>
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
          : route.status === 'REMOVED'
            ? `下线于 ${formatDate(route.retiredAt)}`
            : `更新于 ${formatDate(route.updatedAt)}`}
      </p>
      <div className={styles.cardActions}>
        {route.version && (
          <button type="button" onClick={onVisual}>
            {route.version.hasVisualAnnotation ? '查看线路视觉' : '标记线路位置'}
          </button>
        )}
        {route.actions.canEdit && (
          <button type="button" onClick={onEdit}>
            编辑草稿
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
            线路下线
          </button>
        )}
      </div>
    </article>
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
  initial: OperationalRoute | null;
  onCancel: () => void;
  onSaved: () => Promise<void>;
  onWallCreated: () => Promise<void>;
}) {
  const [form, setForm] = useState<RouteInput>(() =>
    initial
      ? {
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
        }
      : emptyForm,
  );
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
      const route = initial
        ? await updateOperationalRoute(initial.id, input)
        : await createOperationalRoute(input);
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
      title={initial ? `编辑草稿 ${initial.code}` : '新建线路'}
      description="第一阶段建档不要求三维模型和精确孔位。"
    >
      <form className={styles.editor} onSubmit={submit}>
        <div className={styles.formGrid}>
          <label>
            线路编号
            <input
              required
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
            {saving ? '保存中…' : '保存线路草稿'}
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
      PUBLISHED: '已发布',
      INACTIVE: '已停用',
      REMOVED: '已下线',
    } as const
  )[status];
}

function formatDate(value: string | null) {
  return value
    ? new Intl.DateTimeFormat('zh-CN', { dateStyle: 'medium' }).format(new Date(value))
    : '未记录';
}
