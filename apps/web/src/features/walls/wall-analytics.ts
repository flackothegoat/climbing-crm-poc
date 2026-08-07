import type {
  ClimbObservation,
  MonthlyPerformanceSummary,
  RoutePerformanceSummary,
} from './wall.types';

const countedOutcomes = new Set<ClimbObservation['outcome']>(['COMPLETED', 'FAILED']);

export function summarizeRoutePerformance(
  observations: ClimbObservation[],
  routeId: string,
): RoutePerformanceSummary {
  const relevant = observations.filter(
    (item) => item.routeId === routeId && countedOutcomes.has(item.outcome),
  );
  const completed = relevant.filter((item) => item.outcome === 'COMPLETED').length;
  return {
    attempts: relevant.length,
    completed,
    completionRate: percentage(completed, relevant.length),
    routeId,
    uniqueClimbers: new Set(relevant.flatMap((item) => (item.climberKey ? [item.climberKey] : [])))
      .size,
  };
}

export function buildMonthlyPerformance(
  observations: ClimbObservation[],
  routeIds: string[],
  months: string[],
): MonthlyPerformanceSummary[] {
  return months.flatMap((month) =>
    routeIds.map((routeId) => ({
      ...summarizeRoutePerformance(
        observations.filter((item) => item.observedAt.startsWith(month)),
        routeId,
      ),
      month,
    })),
  );
}

export function summarizeAllRoutes(observations: ClimbObservation[]): RoutePerformanceSummary {
  const relevant = observations.filter((item) => countedOutcomes.has(item.outcome));
  const completed = relevant.filter((item) => item.outcome === 'COMPLETED').length;
  return {
    attempts: relevant.length,
    completed,
    completionRate: percentage(completed, relevant.length),
    routeId: 'all',
    uniqueClimbers: new Set(relevant.flatMap((item) => (item.climberKey ? [item.climberKey] : [])))
      .size,
  };
}

function percentage(numerator: number, denominator: number): number {
  return denominator ? Math.round((numerator / denominator) * 1_000) / 10 : 0;
}
