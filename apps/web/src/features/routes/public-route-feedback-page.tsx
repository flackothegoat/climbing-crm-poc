'use client';

import { useEffect, useState, type FormEvent } from 'react';
import Image from 'next/image';
import { climbingColorCss } from '../common/climbing-colors';
import {
  getPublicRoute,
  publicRoutePhotoUrl,
  submitRouteFeedback,
  type DifficultyVote,
  type EnjoymentVote,
  type FeedbackOutcome,
  type PublicRoute,
} from './route-operations-api';
import styles from './public-route.module.css';
import { RouteVisualTopo } from './route-visual-topo';

export function PublicRouteFeedbackPage({ token }: { token: string }) {
  const [route, setRoute] = useState<PublicRoute | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  useEffect(() => {
    getPublicRoute(token)
      .then(setRoute)
      .catch((cause: unknown) =>
        setError(cause instanceof Error ? cause.message : '线路二维码无效'),
      )
      .finally(() => setLoading(false));
  }, [token]);

  if (loading) return <PublicState title="正在读取线路…" detail="请稍候" />;
  if (error || !route) return <PublicState title="无法打开线路" detail={error || '二维码无效'} />;
  return (
    <main
      className={styles.page}
      style={{ '--route-color': climbingColorCss(route.color) } as React.CSSProperties}
    >
      <header className={styles.header}>
        <span className={styles.brandMark}>↗</span>
        <div>
          <strong>{route.gymName}</strong>
          <small>线路反馈</small>
        </div>
      </header>
      <article className={styles.routeCard}>
        <div className={styles.routeMeta}>
          <span>{route.code}</span>
          <strong>{route.grade}</strong>
        </div>
        <h1>{route.name}</h1>
        <p>{route.wallSegments.map((wall) => `${wall.code} ${wall.name}`).join(' · ')}</p>
        {route.hasPhoto && (
          <Image
            unoptimized
            width={900}
            height={600}
            className={styles.routePhoto}
            alt={`${route.code} ${route.name} 线路照片`}
            src={publicRoutePhotoUrl(token)}
          />
        )}
        {route.visualAnnotation && (
          <RouteVisualTopo
            color={climbingColorCss(route.color)}
            compact
            points={route.visualAnnotation.points.map((point) => ({
              ...point,
              wallSegmentId: point.wallSegmentCode ?? '',
            }))}
            segments={route.wallSegments.map((wall) => ({
              id: wall.code,
              code: wall.code,
              name: wall.name,
            }))}
          />
        )}
        <div className={styles.tags}>
          {route.styleTags.map((tag) => (
            <span key={tag}>{tag}</span>
          ))}
        </div>
        {route.description && <p className={styles.description}>{route.description}</p>}
      </article>
      {route.availability === 'ACTIVE' ? (
        <FeedbackForm token={token} />
      ) : (
        <section className={styles.retired}>
          <strong>这条线路已经下线</strong>
          <p>历史反馈已保留，但不再接收新反馈。</p>
        </section>
      )}
      <footer>
        <p>{route.metricNotice}</p>
        <span>不做人脸识别 · 匿名反馈 · 无需下载 App</span>
      </footer>
    </main>
  );
}

function FeedbackForm({ token }: { token: string }) {
  const [outcome, setOutcome] = useState<FeedbackOutcome | null>(null);
  const [difficulty, setDifficulty] = useState<DifficultyVote | null>(null);
  const [enjoyment, setEnjoyment] = useState<EnjoymentVote | null>(null);
  const [safetyConcern, setSafetyConcern] = useState(false);
  const [comment, setComment] = useState('');
  const [showComment, setShowComment] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [submitted, setSubmitted] = useState(false);
  const [error, setError] = useState('');

  async function submit(event: FormEvent) {
    event.preventDefault();
    if (!outcome || !difficulty || !enjoyment) return;
    setSubmitting(true);
    setError('');
    try {
      await submitRouteFeedback(token, {
        outcome,
        difficulty,
        enjoyment,
        safetyConcern,
        comment: comment || undefined,
        anonymousSessionId: anonymousSessionId(),
        requestKey: crypto.randomUUID(),
      });
      setSubmitted(true);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : '反馈提交失败');
    } finally {
      setSubmitting(false);
    }
  }

  if (submitted) {
    return (
      <section className={styles.success}>
        <span>✓</span>
        <h2>反馈已记录</h2>
        <p>如果稍后完攀，可以再次扫码更新本轮反馈，不会重复计算。</p>
        <button type="button" onClick={() => setSubmitted(false)}>
          更新反馈
        </button>
      </section>
    );
  }

  return (
    <form className={styles.form} onSubmit={submit}>
      <header>
        <p>大约 10 秒</p>
        <h2>这条线路怎么样？</h2>
      </header>
      <ChoiceGroup
        title="完成了吗？"
        value={outcome}
        onSelect={(value) => setOutcome(value as FeedbackOutcome)}
        options={[
          ['COMPLETED', '已完攀'],
          ['ATTEMPTING', '尝试中'],
        ]}
      />
      <ChoiceGroup
        title="实际难度"
        value={difficulty}
        onSelect={(value) => setDifficulty(value as DifficultyVote)}
        options={[
          ['EASIER', '偏简单'],
          ['AS_EXPECTED', '合适'],
          ['HARDER', '偏难'],
        ]}
      />
      <ChoiceGroup
        title="喜欢这条线路吗？"
        value={enjoyment}
        onSelect={(value) => setEnjoyment(value as EnjoymentVote)}
        options={[
          ['DISLIKE', '不喜欢'],
          ['NEUTRAL', '一般'],
          ['LIKE', '喜欢'],
        ]}
      />
      <label className={styles.safety}>
        <input
          type="checkbox"
          checked={safetyConcern}
          onChange={(event) => setSafetyConcern(event.target.checked)}
        />
        <span>
          <strong>我有安全方面的疑虑</strong>
          <small>馆方会优先复核，不代表事故判定。</small>
        </span>
      </label>
      <button
        className={styles.commentToggle}
        type="button"
        onClick={() => setShowComment((value) => !value)}
      >
        {showComment ? '收起补充建议' : '补充一句建议（可选）'}
      </button>
      {showComment && (
        <textarea
          maxLength={300}
          value={comment}
          placeholder="最多 300 字，请勿填写姓名、电话等个人信息"
          onChange={(event) => setComment(event.target.value)}
        />
      )}
      {error && <p className={styles.error}>{error}</p>}
      <button
        className={styles.submit}
        disabled={!outcome || !difficulty || !enjoyment || submitting}
        type="submit"
      >
        {submitting ? '正在提交…' : '提交匿名反馈'}
      </button>
    </form>
  );
}

function ChoiceGroup({
  title,
  value,
  options,
  onSelect,
}: {
  title: string;
  value: string | null;
  options: Array<[string, string]>;
  onSelect: (value: string) => void;
}) {
  return (
    <fieldset className={styles.choiceGroup}>
      <legend>{title}</legend>
      <div>
        {options.map(([key, label]) => (
          <button
            aria-pressed={value === key}
            className={value === key ? styles.selected : ''}
            key={key}
            type="button"
            onClick={() => onSelect(key)}
          >
            {label}
          </button>
        ))}
      </div>
    </fieldset>
  );
}

function PublicState({ title, detail }: { title: string; detail: string }) {
  return (
    <main className={styles.state}>
      <span>↗</span>
      <h1>{title}</h1>
      <p>{detail}</p>
    </main>
  );
}

function anonymousSessionId() {
  const key = 'climbing-route-feedback-session';
  const existing = localStorage.getItem(key);
  if (existing) return existing;
  const created = `${crypto.randomUUID()}-${crypto.randomUUID()}`;
  localStorage.setItem(key, created);
  return created;
}
