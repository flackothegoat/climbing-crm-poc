'use client';

import { FormEvent, useState } from 'react';
import {
  cameraObservationEvidenceUrl,
  reviewCameraObservation,
  type CameraObservation,
  type CameraObservationReviewDecision,
} from './camera-live-api';
import {
  displayReviewStatus,
  eventLabel,
  failureReasonLabel,
  finalOutcomeLabel,
  formatScore,
  outcomeLabel,
  reviewStatusLabel,
} from './camera-observation-presenter';
import styles from './camera-observation-panel.module.css';

export function CameraObservationDetail({
  observation,
  onClose,
  onReviewed,
}: {
  observation: CameraObservation;
  onClose: () => void;
  onReviewed: (value: CameraObservation) => void;
}) {
  const [decision, setDecision] = useState<CameraObservationReviewDecision>('CONFIRM');
  const [comment, setComment] = useState('');
  const [message, setMessage] = useState('');
  const [saving, setSaving] = useState(false);
  const evidenceAvailable =
    observation.evidence?.status === 'AVAILABLE' &&
    new Date(observation.evidence.expiresAt).getTime() > Date.now();

  async function submitReview(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setSaving(true);
    setMessage('');
    try {
      onReviewed(await reviewCameraObservation(observation.id, decision, comment || undefined));
      setMessage('复核结论已保存，算法原始判定保持不变。');
      setComment('');
    } catch (reviewError) {
      setMessage(reviewError instanceof Error ? reviewError.message : '复核保存失败');
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className={styles.backdrop} role="presentation" onMouseDown={onClose}>
      <aside
        className={styles.detail}
        role="dialog"
        aria-modal="true"
        onMouseDown={(event) => event.stopPropagation()}
      >
        <header>
          <div>
            <small>{observation.route.code}</small>
            <h3>{observation.route.name}</h3>
          </div>
          <button type="button" aria-label="关闭" onClick={onClose}>
            ×
          </button>
        </header>
        <dl className={styles.summary}>
          <div>
            <dt>识别时间</dt>
            <dd>{new Date(observation.observedAt).toLocaleString('zh-CN')}</dd>
          </div>
          <div>
            <dt>算法结果</dt>
            <dd>{outcomeLabel(observation.outcome)}</dd>
          </div>
          <div>
            <dt>算法评分</dt>
            <dd>{formatScore(observation.analysis?.confidence)}</dd>
          </div>
          <div>
            <dt>最终结论</dt>
            <dd>{finalOutcomeLabel(observation)}</dd>
          </div>
          <div>
            <dt>复核状态</dt>
            <dd>{reviewStatusLabel(displayReviewStatus(observation))}</dd>
          </div>
        </dl>
        <p className={styles.scoreNote}>
          算法评分来自事件规则与阈值，不代表统计意义上的判断正确概率。
        </p>
        <section>
          <h4>录像证据</h4>
          {evidenceAvailable ? (
            <>
              <video
                controls
                preload="metadata"
                src={cameraObservationEvidenceUrl(observation.id)}
              />
              <p>
                录像将在 {new Date(observation.evidence!.expiresAt).toLocaleString('zh-CN')}{' '}
                自动过期。
              </p>
            </>
          ) : (
            <p>
              {observation.evidence ? '录像已按安全策略过期。' : 'Worker 尚未上传本次识别录像。'}
            </p>
          )}
        </section>
        <section>
          <h4>算法事件</h4>
          {observation.analysis?.failureReasons?.length ? (
            <p>
              失败原因：{observation.analysis.failureReasons.map(failureReasonLabel).join('、')}
            </p>
          ) : null}
          {observation.analysis?.events?.length ? (
            <ol className={styles.events}>
              {observation.analysis.events.map((event, index) => (
                <li key={`${event.type}-${event.timestampS}-${index}`}>
                  <strong>
                    {eventLabel(event.type)} · {event.timestampS.toFixed(1)} 秒
                  </strong>
                  <span>
                    {event.evidence} · 评分 {formatScore(event.confidence)}
                  </span>
                </li>
              ))}
            </ol>
          ) : (
            <p>没有可显示的算法事件。</p>
          )}
        </section>
        {observation.latestReview ? (
          <section>
            <h4>最近复核</h4>
            <p>
              {observation.latestReview.reviewedBy.email} ·{' '}
              {new Date(observation.latestReview.createdAt).toLocaleString('zh-CN')}
            </p>
            <p>{observation.latestReview.comment || '确认算法原始结论'}</p>
          </section>
        ) : null}
        <form className={styles.reviewForm} onSubmit={submitReview}>
          <h4>提交人工复核</h4>
          <select
            value={decision}
            onChange={(event) => setDecision(event.target.value as CameraObservationReviewDecision)}
          >
            <option value="CONFIRM">确认算法结论</option>
            <option value="OVERRIDE_COMPLETED">改判为完攀</option>
            <option value="OVERRIDE_FAILED">改判为失败</option>
            <option value="INVALIDATE">标记为无效片段</option>
          </select>
          <textarea
            rows={3}
            value={comment}
            placeholder={decision === 'CONFIRM' ? '备注（可选）' : '请填写改判或无效原因'}
            onChange={(event) => setComment(event.target.value)}
          />
          <button type="submit" disabled={saving}>
            {saving ? '保存中…' : '保存复核结论'}
          </button>
          {message ? <p>{message}</p> : null}
        </form>
      </aside>
    </div>
  );
}
