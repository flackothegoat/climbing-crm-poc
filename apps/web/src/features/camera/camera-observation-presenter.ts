import type { CameraObservation } from './camera-live-api';

export function displayReviewStatus(observation: CameraObservation) {
  return observation.reviewStatus === 'UNREVIEWED' && observation.analysis?.requiresReview
    ? 'PENDING'
    : observation.reviewStatus;
}

export function outcomeLabel(outcome: CameraObservation['outcome']) {
  if (outcome === 'COMPLETED') return '完攀';
  if (outcome === 'FAILED') return '失败';
  if (outcome === 'ABANDONED') return '放弃';
  return '不确定';
}

export function reviewStatusLabel(status: string) {
  if (status === 'PENDING') return '待复核';
  if (status === 'CONFIRMED') return '已确认';
  if (status === 'OVERRIDDEN') return '已改判';
  if (status === 'INVALIDATED') return '无效片段';
  return '未复核';
}

export function finalOutcomeLabel(observation: CameraObservation) {
  if (!observation.latestReview) return '待人工裁定';
  if (observation.latestReview.decision === 'INVALIDATE') return '无效片段';
  return observation.latestReview.finalOutcome
    ? outcomeLabel(observation.latestReview.finalOutcome)
    : '—';
}

export function eventLabel(type: string) {
  const labels: Record<string, string> = {
    STARTED: '确认起步',
    FINISH_REACHED: '触达终点',
    FALL_BEFORE_FINISH: '到顶前掉落',
    OFF_ROUTE_CONTACT: '触碰其他线路',
  };
  return labels[type] ?? type;
}

export function failureReasonLabel(reason: string) {
  const labels: Record<string, string> = {
    OFF_ROUTE_CONTACT: '触碰其他线路',
    FALL_BEFORE_FINISH: '到顶前掉落',
    FINISH_NOT_CONFIRMED: '未确认到顶',
    INVALID_OR_UNCONFIRMED_START: '起步无效或未确认',
    TRACKING_LOST: '跟踪丢失',
  };
  return labels[reason] ?? reason;
}

export function formatScore(value: number | undefined) {
  return typeof value === 'number' ? `${Math.round(value * 100)}%` : '—';
}
