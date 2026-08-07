export type WallCode =
  | 'W01'
  | 'W02'
  | 'W03'
  | 'W04'
  | 'W05'
  | 'W06'
  | 'W07'
  | 'W08'
  | 'W09'
  | 'W10'
  | 'W11'
  | 'W12'
  | 'W13'
  | 'W14'
  | 'W15';

export interface WallHole {
  column: number;
  id: string;
  row: number;
  xMm: number;
  zMm: number;
}

export interface WallDefinition {
  angleFromVerticalDegrees: number;
  code: WallCode;
  heightMm: number;
  name: string;
  surfaceHeightMm: number;
  widthMm: number;
}

export interface WallSurveySegment extends WallDefinition {
  calibrationStatus: 'SURVEY_ESTIMATE' | 'FIELD_CALIBRATED';
  end: WallPlanPoint;
  routeCount: number;
  start: WallPlanPoint;
}

export interface WallPlanPoint {
  xM: number;
  zM: number;
}

export type ClimbObservationOutcome = 'COMPLETED' | 'FAILED' | 'ABANDONED' | 'UNKNOWN';

export type ClimbObservationSource = 'DUMMY' | 'MANUAL' | 'CAMERA';

export interface ClimbObservation {
  climberKey?: string;
  id: string;
  observedAt: string;
  outcome: ClimbObservationOutcome;
  routeId: string;
  source: ClimbObservationSource;
}

export interface RoutePerformanceSummary {
  attempts: number;
  completed: number;
  completionRate: number;
  routeId: string;
  uniqueClimbers: number;
}

export interface MonthlyPerformanceSummary extends RoutePerformanceSummary {
  month: string;
}

export interface WallCalibration {
  horizontalPitchMm: number;
  note: string;
  status: 'ESTIMATED_FROM_SCAN' | 'FIELD_CALIBRATED';
  verticalPitchMm: number;
}
