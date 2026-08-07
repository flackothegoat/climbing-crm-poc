import { apiRequest } from '../../lib/api';
import type { RouteSettingPlan } from '../route-setting/route-setting.types';
import type { ClimbObservation, ClimbObservationOutcome } from './wall.types';

let demoSeedRequest: Promise<void> | null = null;

export function ensureW06DemoData(): Promise<void> {
  if (!demoSeedRequest) {
    demoSeedRequest = apiRequest('/walls/demo-seeds/w06', { method: 'POST' })
      .then(() => undefined)
      .catch((error: unknown) => {
        demoSeedRequest = null;
        throw error;
      });
  }
  return demoSeedRequest;
}

export function getRouteSettingPlan(wallCode = 'W06') {
  return apiRequest<RouteSettingPlan & { dataSource: 'DUMMY' | 'MANUAL'; persisted: true }>(
    `/routes/setting-plan?wallCode=${encodeURIComponent(wallCode)}`,
  );
}

export function saveRouteSettingPlan(plan: RouteSettingPlan) {
  return apiRequest<RouteSettingPlan>(
    `/routes/setting-plan/${encodeURIComponent(plan.wall.code)}`,
    {
      method: 'PUT',
      body: JSON.stringify(plan),
    },
  );
}

export function getClimbObservations(wallCode = 'W06') {
  const query = new URLSearchParams({ wallCode });
  return apiRequest<ClimbObservation[]>(`/climb-observations?${query.toString()}`);
}

export function createManualClimbObservation(input: {
  wallCode: string;
  routeId: string;
  outcome: ClimbObservationOutcome;
  observedAt: string;
  requestKey: string;
  climberKey?: string;
}) {
  return apiRequest<ClimbObservation>('/climb-observations', {
    method: 'POST',
    body: JSON.stringify(input),
  });
}
