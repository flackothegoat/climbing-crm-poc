import { describe, expect, it } from 'vitest';
import { buildMonthlyPerformance, summarizeRoutePerformance } from './wall-analytics';
import type { ClimbObservation } from './wall.types';

const observations: ClimbObservation[] = [
  observation('1', '2026-07-01', 'COMPLETED', 'visitor-a'),
  observation('2', '2026-07-02', 'FAILED', 'visitor-a'),
  observation('3', '2026-07-03', 'COMPLETED', 'visitor-b'),
  observation('4', '2026-07-04', 'ABANDONED', 'visitor-c'),
  observation('5', '2026-06-01', 'FAILED', 'visitor-d'),
];

describe('wall route performance', () => {
  it('calculates completion rate from completed and failed attempts only', () => {
    expect(summarizeRoutePerformance(observations, 'route-green')).toEqual({
      attempts: 4,
      completed: 2,
      completionRate: 50,
      routeId: 'route-green',
      uniqueClimbers: 3,
    });
  });

  it('builds an explicit zero-value month when no observations exist', () => {
    const monthly = buildMonthlyPerformance(
      observations,
      ['route-green'],
      ['2026-06', '2026-07', '2026-08'],
    );
    expect(
      monthly.map(({ month, attempts, completionRate }) => ({ month, attempts, completionRate })),
    ).toEqual([
      { month: '2026-06', attempts: 1, completionRate: 0 },
      { month: '2026-07', attempts: 3, completionRate: 66.7 },
      { month: '2026-08', attempts: 0, completionRate: 0 },
    ]);
  });
});

function observation(
  id: string,
  date: string,
  outcome: ClimbObservation['outcome'],
  climberKey: string,
): ClimbObservation {
  return {
    climberKey,
    id,
    observedAt: `${date}T12:00:00+08:00`,
    outcome,
    routeId: 'route-green',
    source: 'DUMMY',
  };
}
