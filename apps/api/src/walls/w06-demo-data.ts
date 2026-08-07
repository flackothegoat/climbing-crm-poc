import type { ClimbObservationOutcome, Prisma, RoutePlacementRole } from '@prisma/client';

export const W06_AREA = {
  code: 'TIANYU-1F',
  name: '天宇岩馆一楼',
  floorLabel: '一楼',
} as const;

const widths = [
  791, 567, 4_531, 4_135, 734, 5_592, 1_182, 5_131, 3_119, 821, 6_433, 924, 2_445, 3_358, 5_698,
] as const;

const surveyPoints = [
  { xM: -12.98, zM: -12.78 },
  { xM: -12.273, zM: -13.134 },
  { xM: -11.731, zM: -12.965 },
  { xM: -7.804, zM: -15.226 },
  { xM: -5.657, zM: -11.69 },
  { xM: -5.918, zM: -11.004 },
  { xM: -3.463, zM: -5.977 },
  { xM: -2.521, zM: -5.262 },
  { xM: 0.296, zM: -0.973 },
  { xM: 1.35, zM: 1.962 },
  { xM: 1.991, zM: 2.475 },
  { xM: 5.594, zM: 7.802 },
  { xM: 5.624, zM: 8.726 },
  { xM: 7.873, zM: 9.684 },
  { xM: 9.619, zM: 12.552 },
  { xM: 4.782, zM: 15.56 },
] as const;

export const WALL_SEGMENT_SEEDS = widths.map((widthMm, index) => {
  const code = `W${String(index + 1).padStart(2, '0')}`;
  const isW06 = code === 'W06';
  return {
    code,
    name: `${W06_AREA.name} ${code}`,
    widthMm,
    heightMm: 4_100,
    surfaceHeightMm: isW06 ? 4_168 : 4_100,
    angleFromVerticalDegrees: isW06 ? 10.3 : null,
    horizontalPitchMm: isW06 ? 200 : null,
    verticalPitchMm: isW06 ? 200 : null,
    metadata: { start: surveyPoints[index], end: surveyPoints[index + 1] } as Prisma.InputJsonValue,
  };
});

export const W06_HOLE_SEEDS = Array.from({ length: 28 * 21 }, (_, index) => {
  const column = index % 28;
  const row = Math.floor(index / 28);
  return {
    code: w06HoleCode(column, row),
    column,
    row,
    uMm: Math.round((5_592 - 27 * 200) / 2 + column * 200),
    vMm: Math.round((4_168 - 20 * 200) / 2 + row * 200),
  };
});

export const W06_ROUTE_SEEDS = [
  { code: 'route-green', name: '青苔', displayColor: 'green', grade: 'V2' },
  { code: 'route-red', name: '赤脊', displayColor: 'red', grade: 'V4' },
  { code: 'route-yellow', name: '暖光', displayColor: 'yellow', grade: 'V3' },
] as const;

const placementSeeds: Array<{
  assetKey: string;
  column: number;
  row: number;
  rotationDegrees: number;
}> = [
  ...routePlacements('test-green', [5, 7, 6, 8, 7, 9, 8], [-12, 18, -25, 8, 32, -16, 12]),
  ...routePlacements('test-red', [13, 15, 14, 16, 15, 17, 16], [-18, 15, 30, -24, 10, 26, -8]),
  ...routePlacements('test-yellow', [21, 23, 22, 24, 23, 25, 24], [12, -18, 22, -28, 16, -10, 20]),
];

export function placementsForRoute(routeCode: string) {
  const assetKey = routeCode.replace('route-', 'test-');
  return placementSeeds
    .filter((placement) => placement.assetKey === assetKey)
    .map((placement) => ({
      demoAssetKey: placement.assetKey,
      holeCode: w06HoleCode(placement.column, placement.row),
      role: placementRole(placement.row),
      rotationDegrees: placement.rotationDegrees,
    }));
}

export const PERFORMANCE_MONTHS = [
  '2026-02',
  '2026-03',
  '2026-04',
  '2026-05',
  '2026-06',
  '2026-07',
] as const;

const observationSeeds = [
  ...monthlyRouteSeeds('route-green', [72, 84, 91, 105, 116, 124], [52, 62, 69, 82, 93, 102], 34),
  ...monthlyRouteSeeds('route-red', [48, 55, 59, 66, 73, 79], [21, 25, 28, 32, 38, 44], 27),
  ...monthlyRouteSeeds('route-yellow', [61, 68, 77, 83, 92, 101], [37, 43, 49, 55, 64, 72], 31),
];

export function createDummyObservations(routeIdsByCode: Map<string, string>) {
  return observationSeeds.flatMap((seed) =>
    Array.from({ length: seed.attempts }, (_, index) => ({
      routeId: routeIdsByCode.get(seed.routeCode)!,
      outcome: (index < seed.completed ? 'COMPLETED' : 'FAILED') as ClimbObservationOutcome,
      source: 'DUMMY' as const,
      observedAt: new Date(
        `${seed.month}-${String((index % 27) + 1).padStart(2, '0')}T${String(10 + (index % 10)).padStart(2, '0')}:00:00+08:00`,
      ),
      climberKey: `${seed.month}-${seed.routeCode}-visitor-${index % seed.uniqueClimbers}`,
      requestKey: `w06-dummy-${seed.month}-${seed.routeCode}-${String(index + 1).padStart(3, '0')}`,
    })),
  );
}

function routePlacements(assetKey: string, columns: number[], rotations: number[]) {
  const rows = [1, 4, 7, 10, 13, 16, 19];
  return rows.map((row, index) => ({
    assetKey,
    column: columns[index],
    row,
    rotationDegrees: rotations[index],
  }));
}

function placementRole(row: number): RoutePlacementRole {
  if (row === 1) return 'START';
  if (row === 19) return 'FINISH';
  return 'NORMAL';
}

function monthlyRouteSeeds(
  routeCode: string,
  attempts: number[],
  completed: number[],
  startingClimbers: number,
) {
  return PERFORMANCE_MONTHS.map((month, index) => ({
    routeCode,
    month,
    attempts: attempts[index],
    completed: completed[index],
    uniqueClimbers: startingClimbers + index * 3,
  }));
}

function w06HoleCode(column: number, row: number): string {
  return `W06-C${String(column + 1).padStart(2, '0')}-R${String(row + 1).padStart(2, '0')}`;
}
