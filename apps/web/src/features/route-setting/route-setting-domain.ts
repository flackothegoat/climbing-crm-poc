import { W06_HOLES } from '../walls/w06-wall-data';
import type { WallHole } from '../walls/wall.types';
import { climbingColorLabel } from '../common/climbing-colors';
import type {
  HoldAssetDefinition,
  PlacementCollision,
  PlacementMountMatch,
  RoutePlacement,
  RouteSettingPlan,
} from './route-setting.types';

const collisionSafetyGapMm = 24;

export function findWallHole(holeId: string): WallHole | undefined {
  return W06_HOLES.find((hole) => hole.id === holeId);
}

export function findNearestWallHole(xMm: number, zMm: number): WallHole {
  return W06_HOLES.reduce((nearest, candidate) =>
    squaredDistance(candidate, { xMm, zMm }) < squaredDistance(nearest, { xMm, zMm })
      ? candidate
      : nearest,
  );
}

export function movePlacement(
  plan: RouteSettingPlan,
  placementId: string,
  holeId: string,
): RouteSettingPlan {
  return updatePlan(plan, {
    placements: plan.placements.map((placement) =>
      placement.id === placementId ? { ...placement, holeId } : placement,
    ),
  });
}

export function rotatePlacement(
  plan: RouteSettingPlan,
  placementId: string,
  deltaDegrees: number,
): RouteSettingPlan {
  return updatePlan(plan, {
    placements: plan.placements.map((placement) =>
      placement.id === placementId
        ? {
            ...placement,
            rotationDegrees: normalizeDegrees(placement.rotationDegrees + deltaDegrees),
          }
        : placement,
    ),
  });
}

export function removeRoutePlacements(plan: RouteSettingPlan, routeId: string): RouteSettingPlan {
  return updatePlan(plan, {
    placements: plan.placements.filter((placement) => placement.routeId !== routeId),
  });
}

export function removePlacement(plan: RouteSettingPlan, placementId: string): RouteSettingPlan {
  return updatePlan(plan, {
    placements: plan.placements.filter((placement) => placement.id !== placementId),
  });
}

export function addPlacement(
  plan: RouteSettingPlan,
  placement: Omit<RoutePlacement, 'id'>,
): RouteSettingPlan {
  return updatePlan(plan, {
    placements: [...plan.placements, { ...placement, id: createPlacementId() }],
  });
}

export function findPlacementCollisions(
  plan: RouteSettingPlan,
  assets: HoldAssetDefinition[],
): PlacementCollision[] {
  const collisions: PlacementCollision[] = [];
  for (let firstIndex = 0; firstIndex < plan.placements.length; firstIndex += 1) {
    for (let secondIndex = firstIndex + 1; secondIndex < plan.placements.length; secondIndex += 1) {
      const first = plan.placements[firstIndex];
      const second = plan.placements[secondIndex];
      if (placementsCollide(first, second, assets)) {
        collisions.push({ firstPlacementId: first.id, secondPlacementId: second.id });
      }
    }
  }
  return collisions;
}

export function matchPlacementMount(
  placement: RoutePlacement,
  assets: HoldAssetDefinition[],
): PlacementMountMatch {
  const asset = assetById(placement.assetId, assets);
  const primaryHole = findWallHole(placement.holeId);
  if (!asset || !primaryHole) return { matchedHoles: [], valid: false };
  const radians = (placement.rotationDegrees * Math.PI) / 180;
  const matchedHoles = asset.mountPattern.points.map((point) => {
    const xMm =
      primaryHole.xMm + point.offsetXMm * Math.cos(radians) - point.offsetZMm * Math.sin(radians);
    const zMm =
      primaryHole.zMm + point.offsetXMm * Math.sin(radians) + point.offsetZMm * Math.cos(radians);
    const nearest = findNearestWallHole(xMm, zMm);
    return {
      role: point.role,
      holeId: nearest.id,
      distanceMm: Math.round(Math.sqrt(squaredDistance(nearest, { xMm, zMm })) * 10) / 10,
    };
  });
  return {
    matchedHoles,
    valid:
      matchedHoles.length > 0 &&
      matchedHoles.every((match) => match.distanceMm <= mountSnapToleranceMm) &&
      new Set(matchedHoles.map((match) => match.holeId)).size === matchedHoles.length,
  };
}

export function placementHasMountConflict(
  plan: RouteSettingPlan,
  placementId: string,
  assets: HoldAssetDefinition[],
): boolean {
  const placement = plan.placements.find((item) => item.id === placementId);
  if (!placement) return true;
  const mount = matchPlacementMount(placement, assets);
  if (!mount.valid) return true;
  const occupiedByOthers = new Set(
    plan.placements
      .filter((item) => item.id !== placementId)
      .flatMap((item) =>
        matchPlacementMount(item, assets).matchedHoles.map((match) => match.holeId),
      ),
  );
  return mount.matchedHoles.some((match) => occupiedByOthers.has(match.holeId));
}

export function exportRouteSettingPlanJson(plan: RouteSettingPlan): string {
  return `${JSON.stringify(plan, null, 2)}\n`;
}

export function exportPlacementCsv(plan: RouteSettingPlan, assets: HoldAssetDefinition[]): string {
  const header = [
    '墙段',
    '线路',
    '颜色',
    '主孔位',
    '占用孔位',
    '安装型式',
    '锚点状态',
    '列',
    '行',
    'X_mm',
    'Z_mm',
    '旋转_deg',
  ];
  const rows = plan.placements.map((placement) => placementCsvRow(plan, placement, assets));
  return [header, ...rows].map((row) => row.map(csvCell).join(',')).join('\n');
}

export function downloadTextFile(filename: string, content: string, type: string): void {
  const link = document.createElement('a');
  link.href = URL.createObjectURL(new Blob([content], { type }));
  link.download = filename;
  document.body.append(link);
  link.click();
  link.remove();
  window.setTimeout(() => URL.revokeObjectURL(link.href), 1000);
}

function placementsCollide(
  first: RoutePlacement,
  second: RoutePlacement,
  assets: HoldAssetDefinition[],
): boolean {
  const firstHole = findWallHole(first.holeId);
  const secondHole = findWallHole(second.holeId);
  const firstAsset = assetById(first.assetId, assets);
  const secondAsset = assetById(second.assetId, assets);
  if (!firstHole || !secondHole || !firstAsset || !secondAsset) return false;
  const minimumDistance =
    firstAsset.collisionRadiusMm + secondAsset.collisionRadiusMm + collisionSafetyGapMm;
  return squaredDistance(firstHole, secondHole) < minimumDistance * minimumDistance;
}

function placementCsvRow(
  plan: RouteSettingPlan,
  placement: RoutePlacement,
  assets: HoldAssetDefinition[],
): Array<string | number> {
  const hole = findWallHole(placement.holeId);
  const route = plan.routes.find((item) => item.id === placement.routeId);
  const asset = assetById(placement.assetId, assets);
  const mount = matchPlacementMount(placement, assets);
  return [
    plan.wall.code,
    route?.name ?? placement.routeId,
    asset ? climbingColorLabel(asset.color) : '',
    placement.holeId,
    mount.matchedHoles.map((item) => item.holeId).join('|'),
    asset?.mountPattern.type ?? '',
    asset?.mountPattern.status ?? '',
    hole ? hole.column + 1 : '',
    hole ? hole.row + 1 : '',
    hole?.xMm ?? '',
    hole?.zMm ?? '',
    placement.rotationDegrees,
  ];
}

const mountSnapToleranceMm = 18;

function assetById(
  assetId: string,
  assets: HoldAssetDefinition[],
): HoldAssetDefinition | undefined {
  return assets.find((asset) => asset.assetId === assetId);
}

function squaredDistance(
  first: Pick<WallHole, 'xMm' | 'zMm'>,
  second: Pick<WallHole, 'xMm' | 'zMm'>,
): number {
  return (first.xMm - second.xMm) ** 2 + (first.zMm - second.zMm) ** 2;
}

function normalizeDegrees(value: number): number {
  return ((value % 360) + 360) % 360;
}

function updatePlan(plan: RouteSettingPlan, patch: Partial<RouteSettingPlan>): RouteSettingPlan {
  return { ...plan, ...patch, updatedAt: new Date().toISOString() };
}

function createPlacementId(): string {
  return globalThis.crypto?.randomUUID?.() ?? `placement-${Date.now()}`;
}

function csvCell(value: string | number): string {
  const text = String(value);
  return /[",\n]/.test(text) ? `"${text.replaceAll('"', '""')}"` : text;
}
