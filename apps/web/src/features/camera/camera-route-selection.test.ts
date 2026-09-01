import { describe, expect, it } from 'vitest';
import type { CameraRoi, CameraRouteHold } from './camera-live-api';
import { roiForHolds } from './camera-route-selection';

const fallback: CameraRoi = { x1: 0.04, y1: 0.08, x2: 0.96, y2: 0.96 };

describe('roiForHolds', () => {
  it('derives a padded crop from polygon points', () => {
    const hold = {
      id: 'hold-1',
      x: 0.4,
      y: 0.5,
      width: 0.2,
      height: 0.2,
      polygon: [
        { x: 0.3, y: 0.4 },
        { x: 0.5, y: 0.4 },
        { x: 0.5, y: 0.6 },
      ],
      colorHex: '#FF00AA',
      colorCluster: 'prompt',
    } satisfies CameraRouteHold;

    expect(roiForHolds([hold], fallback)).toEqual({
      x1: 0.26,
      y1: 0.36,
      x2: 0.54,
      y2: 0.64,
    });
  });

  it('uses hold bounds for legacy definitions and clamps to the image', () => {
    const hold = {
      id: 'hold-2',
      x: 0.96,
      y: 0.05,
      width: 0.12,
      height: 0.1,
      colorHex: '#111111',
      colorCluster: 'dark',
    } satisfies CameraRouteHold;

    expect(roiForHolds([hold], fallback)).toEqual({
      x1: 0.86,
      y1: 0,
      x2: 1,
      y2: 0.14,
    });
  });

  it('preserves the fallback when no route holds are selected', () => {
    expect(roiForHolds([], fallback)).toBe(fallback);
  });
});
