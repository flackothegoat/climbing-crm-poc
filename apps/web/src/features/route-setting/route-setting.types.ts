import type { WallCalibration, WallDefinition } from '../walls/wall.types';

export type RouteSettingView = 'front' | 'perspective';

export interface HoldAssetDefinition {
  assetId: string;
  colorHex: string;
  colorName: string;
  collisionRadiusMm: number;
  dimensionsMm: { depth: number; height: number; width: number };
  label: string;
  draggable: boolean;
  disabledReason: string | null;
  installedQuantity: number;
  inventoryVersion: number;
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
  previewUrl: string | null;
  reservedQuantity: number;
  warehouseQuantity: number;
}

export interface PlacementMountMatch {
  matchedHoles: Array<{ distanceMm: number; holeId: string; role: string }>;
  valid: boolean;
}

export interface ClimbingRoute {
  color: string;
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
  revision: number;
  routes: ClimbingRoute[];
  schemaVersion: 1;
  settingJob: Pick<WallSettingJob, 'id' | 'name' | 'status'> | null;
  settingJobId: string;
  updatedAt: string;
  wall: WallDefinition;
}

export type WallSettingJobStatus =
  | 'DRAFT'
  | 'READY'
  | 'TEARDOWN_IN_PROGRESS'
  | 'WALL_EMPTY'
  | 'INSTALL_IN_PROGRESS'
  | 'COMPLETED'
  | 'CANCELLED';

export interface WallSettingJob {
  id: string;
  code: string;
  name: string;
  status: WallSettingJobStatus;
  startedAt: string | null;
  completedAt: string | null;
  routeCount: number;
  placementCount: number;
  reservations: Array<{
    holdVariantId: string;
    quantity: number;
    status: 'ACTIVE' | 'CONSUMED' | 'RELEASED';
  }>;
}

export interface PlacementCollision {
  firstPlacementId: string;
  secondPlacementId: string;
}
