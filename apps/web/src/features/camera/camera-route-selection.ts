import type { CameraRoi, CameraRouteHold } from './camera-live-api';

const DEFAULT_PADDING = 0.04;

/**
 * Builds the worker crop from the actual route holds instead of requiring a
 * second, manually maintained rectangle. Coordinates stay normalized so the
 * same definition works with any camera resolution.
 */
export function roiForHolds(
  holds: CameraRouteHold[],
  fallback: CameraRoi,
  padding = DEFAULT_PADDING,
): CameraRoi {
  if (!holds.length) return fallback;

  const points = holds.flatMap((hold) =>
    hold.polygon?.length
      ? hold.polygon
      : [
          { x: hold.x - hold.width / 2, y: hold.y - hold.height / 2 },
          { x: hold.x + hold.width / 2, y: hold.y + hold.height / 2 },
        ],
  );
  const xs = points.map((point) => point.x);
  const ys = points.map((point) => point.y);

  return {
    x1: clamp(Math.min(...xs) - padding),
    y1: clamp(Math.min(...ys) - padding),
    x2: clamp(Math.max(...xs) + padding),
    y2: clamp(Math.max(...ys) + padding),
  };
}

function clamp(value: number) {
  return Math.round(Math.max(0, Math.min(1, value)) * 1_000_000) / 1_000_000;
}
