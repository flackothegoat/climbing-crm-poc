import type { WallCode, WallPlanPoint, WallSurveySegment } from './wall.types';

export const TIANYU_1F_SCAN_MODEL_URL = '/walls/areas/tianyu-1f-scan.glb';

export const TIANYU_1F_AREA = {
  code: 'TIANYU-1F',
  name: '天宇岩馆一楼',
  scanEnvelopeM: { width: 22.81, depth: 31.07, height: 6.58 },
  surveyedWallHeightMm: 4_100,
  unfoldedWidthMm: 45_461,
} as const;

const segmentWidthsMm = [
  791, 567, 4_531, 4_135, 734, 5_592, 1_182, 5_131, 3_119, 821, 6_433, 924, 2_445, 3_358, 5_698,
] as const;

const surveyPoints: WallPlanPoint[] = [
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
];

export const WALL_SURVEY_SEGMENTS: WallSurveySegment[] = segmentWidthsMm.map((widthMm, index) => {
  const code = `W${String(index + 1).padStart(2, '0')}` as WallCode;
  const isW06 = code === 'W06';
  return {
    angleFromVerticalDegrees: isW06 ? 10.3 : 0,
    calibrationStatus: 'SURVEY_ESTIMATE',
    code,
    end: surveyPoints[index + 1],
    heightMm: TIANYU_1F_AREA.surveyedWallHeightMm,
    name: `${TIANYU_1F_AREA.name} ${code}`,
    routeCount: isW06 ? 3 : 0,
    start: surveyPoints[index],
    surfaceHeightMm: isW06 ? 4_168 : TIANYU_1F_AREA.surveyedWallHeightMm,
    widthMm,
  };
});

export function findWallSurveySegment(code: WallCode): WallSurveySegment {
  const segment = WALL_SURVEY_SEGMENTS.find((item) => item.code === code);
  if (!segment) throw new Error(`Unknown wall survey segment: ${code}`);
  return segment;
}
