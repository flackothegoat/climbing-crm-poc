import type { WallCalibration, WallDefinition } from '../walls/wall.types';

export type HoldColor = 'green' | 'red' | 'yellow';

export type RouteSettingView = 'front' | 'perspective';

export interface HoldAssetDefinition {
  assetId: string;
  color: HoldColor;
  collisionRadiusMm: number;
  dimensionsMm: { depth: number; height: number; width: number };
  label: string;
  mountPattern: {
    points: Array<{
      offsetXMm: number;
      offsetZMm: number;
      role: 'PRIMARY_BOLT' | 'SECONDARY_BOLT' | 'SCREW';
    }>;
    status: 'ESTIMATED_FROM_SCAN' | 'FIELD_VERIFIED';
    type: 'SINGLE_BOLT' | 'MULTI_BOLT' | 'SCREW_ON';
  };
  modelUrl: string;
}

export interface PlacementMountMatch {
  matchedHoles: Array<{ distanceMm: number; holeId: string; role: string }>;
  valid: boolean;
}

export interface ClimbingRoute {
  color: HoldColor;
  grade: string;
  id: string;
  name: string;
}

export interface RoutePlacement {
  assetId: string;
  holeId: string;
  id: string;
  role: 'START' | 'NORMAL' | 'FINISH';
  rotationDegrees: number;
  routeId: string;
}

export interface RouteSettingPlan {
  calibration: WallCalibration;
  placements: RoutePlacement[];
  routes: ClimbingRoute[];
  schemaVersion: 1;
  updatedAt: string;
  wall: WallDefinition;
}

export interface PlacementCollision {
  firstPlacementId: string;
  secondPlacementId: string;
}
