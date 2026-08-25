import type { ClimbingColor } from '../common/climbing-colors';

export interface RouteVisualRegionSegment {
  code: string;
  xMax: number;
  xMin: number;
}

export interface RouteVisualRegion {
  modelUrl: string;
  name: string;
  segmentBounds: readonly RouteVisualRegionSegment[];
  verticalBounds: { max: number; min: number };
}

export interface RouteColorAnalysisProfile {
  enabled: boolean;
  hue: number;
  hueTolerance: number;
  minimumSaturation: number;
  minimumValue: number;
}

/**
 * W03-W05 pilot scan, measured in the normalized local coordinates contained in
 * the supplied GLB. Segment boundaries are calibration data and deliberately
 * live outside the renderer so a later server-provided calibration can replace
 * them without changing shader or interaction code.
 */
export const W03_W05_PILOT_REGION: RouteVisualRegion = {
  modelUrl: '/walls/regions/w03-w05-pilot.glb',
  name: 'W03–W05 试点扫描区域',
  segmentBounds: [
    { code: 'W03', xMin: -0.9322, xMax: -0.455 },
    { code: 'W04', xMin: -0.455, xMax: 0.455 },
    { code: 'W05', xMin: 0.455, xMax: 0.9322 },
  ],
  verticalBounds: { min: 0.018, max: 0.884 },
};

const hueProfiles: Partial<Record<ClimbingColor, Omit<RouteColorAnalysisProfile, 'enabled'>>> = {
  RED: profile(0.995, 0.055, 0.3, 0.2),
  ORANGE: profile(0.075, 0.045, 0.32, 0.25),
  YELLOW: profile(0.125, 0.05, 0.28, 0.28),
  GREEN: profile(0.39, 0.085, 0.25, 0.18),
  BLUE: profile(0.585, 0.085, 0.24, 0.18),
  PURPLE: profile(0.84, 0.075, 0.22, 0.16),
  PINK: profile(0.955, 0.065, 0.2, 0.3),
  BROWN: profile(0.065, 0.055, 0.22, 0.08),
};

export function resolveRouteVisualRegion(segmentCodes: readonly string[]) {
  if (!segmentCodes.length) return null;
  const supported = new Set(W03_W05_PILOT_REGION.segmentBounds.map((segment) => segment.code));
  return segmentCodes.every((code) => supported.has(code)) ? W03_W05_PILOT_REGION : null;
}

export function routeColorAnalysisProfile(color: ClimbingColor): RouteColorAnalysisProfile {
  const value = hueProfiles[color];
  return value ? { enabled: true, ...value } : profile(0, 0, 1, 1, false);
}

export function segmentBoundsForRoute(region: RouteVisualRegion, segmentCodes: readonly string[]) {
  const selected = new Set(segmentCodes);
  return region.segmentBounds.filter((segment) => selected.has(segment.code));
}

export function normalizedPointInRegion(
  region: RouteVisualRegion,
  segmentCode: string,
  uNormalized: number,
  vNormalized: number,
) {
  const segment = region.segmentBounds.find((item) => item.code === segmentCode);
  if (!segment) return null;
  return {
    x: mix(segment.xMin, segment.xMax, clamp(uNormalized)),
    y: mix(region.verticalBounds.max, region.verticalBounds.min, clamp(vNormalized)),
  };
}

function profile(
  hue: number,
  hueTolerance: number,
  minimumSaturation: number,
  minimumValue: number,
  enabled = true,
) {
  return { enabled, hue, hueTolerance, minimumSaturation, minimumValue };
}

function clamp(value: number) {
  return Math.max(0, Math.min(1, value));
}

function mix(from: number, to: number, amount: number) {
  return from + (to - from) * amount;
}
