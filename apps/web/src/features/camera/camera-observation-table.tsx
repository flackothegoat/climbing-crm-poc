import type { CameraObservation } from './camera-live-api';
import {
  displayReviewStatus,
  finalOutcomeLabel,
  outcomeLabel,
  reviewStatusLabel,
} from './camera-observation-presenter';
import styles from './camera-observation-panel.module.css';

export function CameraObservationTable({
  items,
  loading,
  onSelect,
}: {
  items: CameraObservation[];
  loading: boolean;
  onSelect: (id: string) => void;
}) {
  if (!items.length) {
    return (
      <div className={styles.empty}>
        <strong>{loading ? '正在读取识别结果' : '没有符合条件的识别结果'}</strong>
        <p>只有已发布、未停用并完成视觉定义的线路才会产生正式记录。</p>
      </div>
    );
  }
  return (
    <div className={styles.tableWrap}>
      <table>
        <thead>
          <tr>
            <th>时间</th>
            <th>线路</th>
            <th>算法结果</th>
            <th title="当前为规则评分，并非统计意义上的判断正确概率">算法评分</th>
            <th>最终结论</th>
            <th>复核状态</th>
            <th aria-label="操作" />
          </tr>
        </thead>
        <tbody>
          {items.map((observation) => (
            <tr key={observation.id}>
              <td>{new Date(observation.observedAt).toLocaleString('zh-CN')}</td>
              <td>
                <strong>{observation.route.code}</strong>
                <small>{observation.route.name}</small>
              </td>
              <td>
                <StatusBadge kind="outcome" value={observation.outcome} />
              </td>
              <td>
                {typeof observation.analysis?.confidence === 'number'
                  ? `${Math.round(observation.analysis.confidence * 100)}%`
                  : '—'}
              </td>
              <td>{finalOutcomeLabel(observation)}</td>
              <td>
                <StatusBadge kind="review" value={displayReviewStatus(observation)} />
              </td>
              <td>
                <button type="button" onClick={() => onSelect(observation.id)}>
                  查看与复核
                </button>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function StatusBadge({ kind, value }: { kind: 'outcome' | 'review'; value: string }) {
  return (
    <span className={styles.badge} data-kind={kind} data-value={value.toLowerCase()}>
      {kind === 'outcome'
        ? outcomeLabel(value as CameraObservation['outcome'])
        : reviewStatusLabel(value)}
    </span>
  );
}
