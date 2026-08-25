import { W06_HOLES } from './w06-wall-data';
import type { RouteSettingPlan } from '../route-setting/route-setting.types';
import { climbingColorCss } from '../common/climbing-colors';
import styles from './walls.module.css';

export function WallRouteMap(props: { plan: RouteSettingPlan; selectedRouteId: string | null }) {
  return (
    <div className={styles.routeMapFrame}>
      <svg
        aria-label="W06 当前线路正立面"
        className={styles.routeMap}
        role="img"
        viewBox={`0 0 ${props.plan.wall.widthMm} ${props.plan.wall.surfaceHeightMm}`}
      >
        <defs>
          <pattern
            height={props.plan.calibration.verticalPitchMm}
            id="wall-hole-grid"
            patternUnits="userSpaceOnUse"
            width={props.plan.calibration.horizontalPitchMm}
          >
            <circle cx="96" cy="84" fill="#6c7b75" r="12" />
          </pattern>
          <filter id="route-shadow" x="-30%" y="-30%" width="160%" height="160%">
            <feDropShadow
              dx="0"
              dy="16"
              floodColor="#183a2e"
              floodOpacity="0.2"
              stdDeviation="12"
            />
          </filter>
        </defs>
        <rect className={styles.routeWallSurface} height="100%" rx="44" width="100%" />
        <rect fill="url(#wall-hole-grid)" height="100%" opacity="0.68" width="100%" />
        {props.plan.routes.map((route) => {
          const placements = props.plan.placements
            .filter((item) => item.routeId === route.id)
            .map((placement) => ({ placement, hole: findHole(placement.holeId) }))
            .filter((item) => item.hole)
            .sort((first, second) => first.hole!.zMm - second.hole!.zMm);
          const points = placements
            .map(({ hole }) => `${hole!.xMm},${props.plan.wall.surfaceHeightMm - hole!.zMm}`)
            .join(' ');
          const muted = props.selectedRouteId && props.selectedRouteId !== route.id;
          return (
            <g key={route.id} opacity={muted ? 0.12 : 1}>
              <polyline
                fill="none"
                filter="url(#route-shadow)"
                points={points}
                stroke={routeColor(route.color)}
                strokeDasharray="18 34"
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth="30"
              />
              {placements.map(({ placement, hole }) => {
                const cy = props.plan.wall.surfaceHeightMm - hole!.zMm;
                const terminal = placement.role !== 'NORMAL';
                return (
                  <g key={placement.id}>
                    {terminal && (
                      <circle
                        cx={hole!.xMm}
                        cy={cy}
                        fill="none"
                        r="72"
                        stroke={routeColor(route.color)}
                        strokeWidth="20"
                      />
                    )}
                    <circle
                      cx={hole!.xMm}
                      cy={cy}
                      fill={routeColor(route.color)}
                      r={terminal ? 47 : 38}
                      stroke="#ffffff"
                      strokeWidth="14"
                    />
                    {terminal && (
                      <text
                        className={styles.routeTerminalLabel}
                        textAnchor="middle"
                        x={hole!.xMm}
                        y={cy - 100}
                      >
                        {placement.role === 'START' ? '起点' : '终点'}
                      </text>
                    )}
                  </g>
                );
              })}
            </g>
          );
        })}
      </svg>
      <div className={styles.routeMapScale}>
        <span>0 m</span>
        <i />
        <span>5.59 m</span>
      </div>
    </div>
  );
}

function findHole(holeId: string) {
  return W06_HOLES.find((hole) => hole.id === holeId);
}

const routeColor = climbingColorCss;
