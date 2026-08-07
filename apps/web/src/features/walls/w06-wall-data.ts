import type { WallCalibration, WallDefinition, WallHole } from './wall.types';

export const W06_WIDTH_MM = 5_592;
export const W06_HEIGHT_MM = 4_100;
export const W06_SURFACE_HEIGHT_MM = 4_168;
export const W06_HOLE_PITCH_MM = 200;
export const W06_HOLE_COLUMNS = 28;
export const W06_HOLE_ROWS = 21;

export const W06_WALL: WallDefinition = {
  code: 'W06',
  name: '天宇岩馆一楼 W06',
  widthMm: W06_WIDTH_MM,
  heightMm: W06_HEIGHT_MM,
  surfaceHeightMm: W06_SURFACE_HEIGHT_MM,
  angleFromVerticalDegrees: 10.3,
};

export const W06_CALIBRATION: WallCalibration = {
  horizontalPitchMm: W06_HOLE_PITCH_MM,
  verticalPitchMm: W06_HOLE_PITCH_MM,
  status: 'ESTIMATED_FROM_SCAN',
  note: 'PDF 扫描估测草案；正式使用前须现场复核原点、行列、缺失孔和边界孔。',
};

export const W06_HOLES = createW06Holes();

function createW06Holes(): WallHole[] {
  const marginX = (W06_WIDTH_MM - (W06_HOLE_COLUMNS - 1) * W06_HOLE_PITCH_MM) / 2;
  const marginZ = (W06_SURFACE_HEIGHT_MM - (W06_HOLE_ROWS - 1) * W06_HOLE_PITCH_MM) / 2;
  return Array.from({ length: W06_HOLE_COLUMNS * W06_HOLE_ROWS }, (_, index) => {
    const column = index % W06_HOLE_COLUMNS;
    const row = Math.floor(index / W06_HOLE_COLUMNS);
    return {
      id: w06HoleId(column, row),
      column,
      row,
      xMm: marginX + column * W06_HOLE_PITCH_MM,
      zMm: marginZ + row * W06_HOLE_PITCH_MM,
    };
  });
}

export function w06HoleId(column: number, row: number): string {
  return `W06-C${String(column + 1).padStart(2, '0')}-R${String(row + 1).padStart(2, '0')}`;
}
