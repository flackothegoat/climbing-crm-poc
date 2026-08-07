import type { ClimbObservation, ClimbObservationOutcome } from './wall.types';

interface MonthlyDummySeed {
  attempts: number;
  completed: number;
  month: string;
  routeId: string;
  uniqueClimbers: number;
}

export const PERFORMANCE_MONTHS = [
  '2026-02',
  '2026-03',
  '2026-04',
  '2026-05',
  '2026-06',
  '2026-07',
];

const seeds: MonthlyDummySeed[] = [
  ...routeSeeds('route-green', [72, 84, 91, 105, 116, 124], [52, 62, 69, 82, 93, 102], 34),
  ...routeSeeds('route-red', [48, 55, 59, 66, 73, 79], [21, 25, 28, 32, 38, 44], 27),
  ...routeSeeds('route-yellow', [61, 68, 77, 83, 92, 101], [37, 43, 49, 55, 64, 72], 31),
];

export const DUMMY_CLIMB_OBSERVATIONS = seeds.flatMap(createSeedObservations);

function routeSeeds(
  routeId: string,
  attempts: number[],
  completed: number[],
  startingClimbers: number,
): MonthlyDummySeed[] {
  return PERFORMANCE_MONTHS.map((month, index) => ({
    attempts: attempts[index],
    completed: completed[index],
    month,
    routeId,
    uniqueClimbers: startingClimbers + index * 3,
  }));
}

function createSeedObservations(seed: MonthlyDummySeed): ClimbObservation[] {
  return Array.from({ length: seed.attempts }, (_, index) => {
    const outcome: ClimbObservationOutcome = index < seed.completed ? 'COMPLETED' : 'FAILED';
    const day = String((index % 27) + 1).padStart(2, '0');
    const hour = String(10 + (index % 10)).padStart(2, '0');
    return {
      climberKey: `${seed.month}-${seed.routeId}-visitor-${index % seed.uniqueClimbers}`,
      id: `${seed.month}-${seed.routeId}-${String(index + 1).padStart(3, '0')}`,
      observedAt: `${seed.month}-${day}T${hour}:00:00+08:00`,
      outcome,
      routeId: seed.routeId,
      source: 'DUMMY',
    };
  });
}
