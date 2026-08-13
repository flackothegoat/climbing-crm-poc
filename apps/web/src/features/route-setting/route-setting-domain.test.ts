import { describe, expect, it } from 'vitest';
import { W06_HOLES } from '../walls/w06-wall-data';
import { HOLD_ASSETS, createSeedRouteSettingPlan } from './route-setting-demo-data';
import {
  exportPlacementCsv,
  exportRouteSettingPlanJson,
  findNearestWallHole,
  findPlacementCollisions,
  matchPlacementMount,
  movePlacement,
  placementHasMountConflict,
  removePlacement,
  removeRoutePlacements,
  rotatePlacement,
} from './route-setting-domain';

describe('W06 route-setting domain', () => {
  const assets = Object.values(HOLD_ASSETS);
  it('builds the estimated 28 by 21 hole grid', () => {
    expect(W06_HOLES).toHaveLength(588);
    expect(W06_HOLES[0]).toMatchObject({ column: 0, row: 0, xMm: 96, zMm: 84 });
    expect(W06_HOLES.at(-1)).toMatchObject({ column: 27, row: 20, xMm: 5496, zMm: 4084 });
  });

  it('snaps coordinates to the nearest hole', () => {
    expect(findNearestWallHole(301, 281).id).toBe('W06-C02-R02');
  });

  it('moves and rotates a placement without mutating the source plan', () => {
    const plan = createSeedRouteSettingPlan('2026-07-30T00:00:00.000Z');
    const placement = plan.placements[0];
    const moved = movePlacement(plan, placement.id, 'W06-C03-R03');
    const rotated = rotatePlacement(moved, placement.id, -30);
    expect(plan.placements[0].holeId).not.toBe('W06-C03-R03');
    expect(rotated.placements[0]).toMatchObject({ holeId: 'W06-C03-R03', rotationDegrees: 318 });
  });

  it('removes only the selected route and preserves an exportable CSV', () => {
    const plan = createSeedRouteSettingPlan();
    const result = removeRoutePlacements(plan, 'route-red');
    expect(result.placements.some((item) => item.routeId === 'route-red')).toBe(false);
    expect(result.placements).toHaveLength(14);
    expect(exportPlacementCsv(result, assets)).toContain('W06-C06-R02');
  });

  it('exports a versioned JSON plan with the calibration boundary intact', () => {
    const exported = JSON.parse(exportRouteSettingPlanJson(createSeedRouteSettingPlan())) as {
      schemaVersion: number;
      calibration: { status: string };
      placements: unknown[];
    };
    expect(exported.schemaVersion).toBe(1);
    expect(exported.calibration.status).toBe('ESTIMATED_FROM_SCAN');
    expect(exported.placements).toHaveLength(21);
  });

  it('reports a collision when two holds occupy adjacent 200 mm holes', () => {
    const plan = createSeedRouteSettingPlan();
    const first = plan.placements[0];
    const second = plan.placements[1];
    const firstHole = W06_HOLES.find((hole) => hole.id === first.holeId)!;
    const adjacent = W06_HOLES.find(
      (hole) => hole.row === firstHole.row && hole.column === firstHole.column + 1,
    )!;
    const moved = movePlacement(plan, second.id, adjacent.id);
    expect(findPlacementCollisions(moved, assets)).toContainEqual({
      firstPlacementId: first.id,
      secondPlacementId: second.id,
    });
  });

  it('matches the scanned single-bolt anchor to its wall hole', () => {
    const plan = createSeedRouteSettingPlan();
    const match = matchPlacementMount(plan.placements[0], assets);
    expect(match).toEqual({
      valid: true,
      matchedHoles: [{ role: 'PRIMARY_BOLT', holeId: 'W06-C06-R02', distanceMm: 0 }],
    });
    expect(placementHasMountConflict(plan, plan.placements[0].id, assets)).toBe(false);
  });

  it('removes one selected placement without changing its route', () => {
    const plan = createSeedRouteSettingPlan();
    const result = removePlacement(plan, plan.placements[0].id);
    expect(result.placements).toHaveLength(20);
    expect(result.routes).toEqual(plan.routes);
  });
});
