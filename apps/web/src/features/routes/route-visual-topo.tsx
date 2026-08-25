'use client';

import type { RouteVisualPoint, RouteWallSegment } from './route-operations-api';
import styles from './route-visual.module.css';

export function RouteVisualTopo({
  color,
  compact = false,
  editable = false,
  onAddPoint,
  points,
  segments,
}: {
  color: string;
  compact?: boolean;
  editable?: boolean;
  onAddPoint?: (point: Omit<RouteVisualPoint, 'role'>) => void;
  points: RouteVisualPoint[];
  segments: RouteWallSegment[];
}) {
  const width = 920;
  const gap = 12;
  const panelWidth = (width - gap * (segments.length - 1)) / Math.max(segments.length, 1);
  const panelAt = (index: number) => index * (panelWidth + gap);
  const projected = points.flatMap((point) => {
    const index = segments.findIndex((segment) => segment.id === point.wallSegmentId);
    if (index < 0) return [];
    return [
      {
        ...point,
        x: panelAt(index) + point.uNormalized * panelWidth,
        y: 34 + point.vNormalized * 380,
      },
    ];
  });
  return (
    <div className={`${styles.topoFrame} ${compact ? styles.compactTopo : ''}`}>
      <svg aria-label="线路正立面图" role="img" viewBox={`0 0 ${width} 450`}>
        {segments.map((segment, index) => (
          <g key={segment.id}>
            <rect
              className={styles.topoWall}
              height="380"
              rx="5"
              width={panelWidth}
              x={panelAt(index)}
              y="34"
              onClick={(event) => {
                if (!editable || !onAddPoint) return;
                const bounds = event.currentTarget.ownerSVGElement?.getBoundingClientRect();
                if (!bounds) return;
                const x = ((event.clientX - bounds.left) / bounds.width) * width;
                const y = ((event.clientY - bounds.top) / bounds.height) * 450;
                onAddPoint({
                  wallSegmentId: segment.id,
                  uNormalized: clamp((x - panelAt(index)) / panelWidth),
                  vNormalized: clamp((y - 34) / 380),
                });
              }}
            />
            <text className={styles.topoLabel} x={panelAt(index) + 12} y="24">
              {segment.code} · {segment.name}
            </text>
          </g>
        ))}
        {projected.length > 1 && (
          <polyline
            className={styles.topoPath}
            points={projected.map((point) => `${point.x},${point.y}`).join(' ')}
            style={{ stroke: color }}
          />
        )}
        {projected.map((point, index) => (
          <g key={`${point.wallSegmentId}-${index}`}>
            <circle
              className={styles.topoPoint}
              cx={point.x}
              cy={point.y}
              r={point.role === 'NORMAL' ? 10 : 14}
              style={{ fill: color }}
            />
            <text className={styles.pointNumber} x={point.x} y={point.y + 4}>
              {point.role === 'START' ? 'S' : point.role === 'FINISH' ? 'T' : index + 1}
            </text>
          </g>
        ))}
      </svg>
    </div>
  );
}

function clamp(value: number) {
  return Math.max(0, Math.min(1, value));
}
