import { WALL_SURVEY_SEGMENTS } from './wall-survey-data';
import type { WallCode } from './wall.types';
import styles from './walls.module.css';

export function WallPlanMap(props: {
  onSelectWall: (code: WallCode) => void;
  selectedWallCode: WallCode;
}) {
  const path = WALL_SURVEY_SEGMENTS.flatMap((segment, index) =>
    index ? [segment.end] : [segment.start, segment.end],
  )
    .map((point) => `${point.xM},${-point.zM}`)
    .join(' ');

  return (
    <svg
      aria-label="天宇一楼墙段俯视定位图"
      className={styles.planMap}
      role="img"
      viewBox="-15 -17 27 34"
    >
      <polyline className={styles.planMapBase} points={path} />
      {WALL_SURVEY_SEGMENTS.map((segment) => {
        const active = props.selectedWallCode === segment.code;
        const centerX = (segment.start.xM + segment.end.xM) / 2;
        const centerY = -(segment.start.zM + segment.end.zM) / 2;
        return (
          <g
            aria-label={`选择 ${segment.code}`}
            className={styles.planMapSegment}
            key={segment.code}
            onClick={() => props.onSelectWall(segment.code)}
            onKeyDown={(event) => {
              if (event.key === 'Enter' || event.key === ' ') props.onSelectWall(segment.code);
            }}
            role="button"
            tabIndex={0}
          >
            <line
              className={active ? styles.planMapLineActive : styles.planMapLine}
              x1={segment.start.xM}
              x2={segment.end.xM}
              y1={-segment.start.zM}
              y2={-segment.end.zM}
            />
            <line
              className={styles.planMapHitArea}
              x1={segment.start.xM}
              x2={segment.end.xM}
              y1={-segment.start.zM}
              y2={-segment.end.zM}
            />
            <circle
              className={active ? styles.planMapNodeActive : styles.planMapNode}
              cx={centerX}
              cy={centerY}
              r="0.64"
            />
            <text x={centerX} y={centerY + 0.2}>
              {segment.code.slice(1)}
            </text>
          </g>
        );
      })}
    </svg>
  );
}
