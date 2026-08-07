import type {
  ClimbingRoute,
  HoldAssetDefinition,
  HoldColor,
  RoutePlacement,
  RouteSettingPlan,
} from './route-setting.types';
import { W06_CALIBRATION, W06_WALL, w06HoleId } from '../walls/w06-wall-data';

export const HOLD_ASSETS: Record<HoldColor, HoldAssetDefinition> = {
  green: {
    assetId: 'test-green',
    color: 'green',
    collisionRadiusMm: 91.04,
    dimensionsMm: { width: 100.67, height: 132.36, depth: 57.87 },
    label: '绿色测试岩点',
    mountPattern: {
      type: 'SINGLE_BOLT',
      status: 'ESTIMATED_FROM_SCAN',
      points: [{ role: 'PRIMARY_BOLT', offsetXMm: 0, offsetZMm: 0 }],
    },
    modelUrl: '/walls/w06/holds/test-green-clean.glb',
  },
  red: {
    assetId: 'test-red',
    color: 'red',
    collisionRadiusMm: 95.79,
    dimensionsMm: { width: 166.02, height: 104.76, depth: 71.68 },
    label: '红色测试岩点',
    mountPattern: {
      type: 'SINGLE_BOLT',
      status: 'ESTIMATED_FROM_SCAN',
      points: [{ role: 'PRIMARY_BOLT', offsetXMm: 0, offsetZMm: 0 }],
    },
    modelUrl: '/walls/w06/holds/test-red-clean.glb',
  },
  yellow: {
    assetId: 'test-yellow',
    color: 'yellow',
    collisionRadiusMm: 91.48,
    dimensionsMm: { width: 145.16, height: 118.44, depth: 49.09 },
    label: '黄色测试岩点',
    mountPattern: {
      type: 'SINGLE_BOLT',
      status: 'ESTIMATED_FROM_SCAN',
      points: [{ role: 'PRIMARY_BOLT', offsetXMm: 0, offsetZMm: 0 }],
    },
    modelUrl: '/walls/w06/holds/test-yellow-clean.glb',
  },
};

const routes: ClimbingRoute[] = [
  { id: 'route-green', name: '青苔', color: 'green', grade: 'V2' },
  { id: 'route-red', name: '赤脊', color: 'red', grade: 'V4' },
  { id: 'route-yellow', name: '暖光', color: 'yellow', grade: 'V3' },
];

const placementSeeds: Array<[HoldColor, number, number, number]> = [
  ['green', 5, 1, -12],
  ['green', 7, 4, 18],
  ['green', 6, 7, -25],
  ['green', 8, 10, 8],
  ['green', 7, 13, 32],
  ['green', 9, 16, -16],
  ['green', 8, 19, 12],
  ['red', 13, 1, -18],
  ['red', 15, 4, 15],
  ['red', 14, 7, 30],
  ['red', 16, 10, -24],
  ['red', 15, 13, 10],
  ['red', 17, 16, 26],
  ['red', 16, 19, -8],
  ['yellow', 21, 1, 12],
  ['yellow', 23, 4, -18],
  ['yellow', 22, 7, 22],
  ['yellow', 24, 10, -28],
  ['yellow', 23, 13, 16],
  ['yellow', 25, 16, -10],
  ['yellow', 24, 19, 20],
];

export function createSeedRouteSettingPlan(now = new Date().toISOString()): RouteSettingPlan {
  return {
    schemaVersion: 1,
    wall: W06_WALL,
    calibration: W06_CALIBRATION,
    routes,
    placements: placementSeeds.map(createSeedPlacement),
    updatedAt: now,
  };
}

function createSeedPlacement(
  [color, column, row, rotationDegrees]: (typeof placementSeeds)[number],
  index: number,
): RoutePlacement {
  return {
    id: `placement-${String(index + 1).padStart(2, '0')}`,
    assetId: HOLD_ASSETS[color].assetId,
    routeId: `route-${color}`,
    holeId: w06HoleId(column, row),
    role: row === 1 ? 'START' : row === 19 ? 'FINISH' : 'NORMAL',
    rotationDegrees,
  };
}
