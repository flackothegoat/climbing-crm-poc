import { describe, expect, it } from 'vitest';
import {
  normalizedPointInRegion,
  resolveRouteVisualRegion,
  routeColorAnalysisProfile,
  segmentBoundsForRoute,
  W03_W05_PILOT_REGION,
} from './route-visual-region';

describe('route visual pilot region', () => {
  it('is selected only when every route wall belongs to W03-W05', () => {
    expect(resolveRouteVisualRegion(['W04', 'W05'])).toBe(W03_W05_PILOT_REGION);
    expect(resolveRouteVisualRegion(['W04', 'W06'])).toBeNull();
    expect(resolveRouteVisualRegion([])).toBeNull();
  });

  it('restricts color analysis to the route wall segments', () => {
    expect(
      segmentBoundsForRoute(W03_W05_PILOT_REGION, ['W04', 'W05']).map((item) => item.code),
    ).toEqual(['W04', 'W05']);
  });

  it('maps persisted top-left normalized points into model-local calibration', () => {
    const topLeft = normalizedPointInRegion(W03_W05_PILOT_REGION, 'W04', 0, 0);
    const bottomRight = normalizedPointInRegion(W03_W05_PILOT_REGION, 'W04', 1, 1);
    expect(topLeft).toEqual({ x: -0.455, y: 0.884 });
    expect(bottomRight?.x).toBeCloseTo(0.455);
    expect(bottomRight?.y).toBeCloseTo(0.018);
  });

  it('uses hue analysis for chromatic business colors and disables ambiguous neutrals', () => {
    expect(routeColorAnalysisProfile('BLUE').enabled).toBe(true);
    expect(routeColorAnalysisProfile('YELLOW').enabled).toBe(true);
    expect(routeColorAnalysisProfile('WHITE').enabled).toBe(false);
    expect(routeColorAnalysisProfile('GRAY').enabled).toBe(false);
  });
});
