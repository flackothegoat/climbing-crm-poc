import { apiRequest } from '../../lib/api';
import type {
  HoldAssetDefinition,
  RouteSettingPlan,
  WallSettingJob,
} from '../route-setting/route-setting.types';
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

let workspaceRequest: Promise<void> | null = null;

export function ensureW06RouteSettingWorkspace(): Promise<void> {
  if (!workspaceRequest) {
    workspaceRequest = apiRequest('/walls/workspaces/w06', { method: 'POST' })
      .then(() => undefined)
      .catch((error: unknown) => {
        workspaceRequest = null;
        throw error;
      });
  }
  return workspaceRequest;
}

export function getRouteSettingPlan(wallCode = 'W06', jobId?: string) {
  const query = new URLSearchParams({ wallCode });
  if (jobId) query.set('jobId', jobId);
  return apiRequest<RouteSettingPlan & { dataSource: 'DUMMY' | 'MANUAL'; persisted: true }>(
    `/routes/setting-plan?${query.toString()}`,
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

export function createOrGetWallSettingJob(wallCode = 'W06') {
  return apiRequest<WallSettingJob>('/wall-setting-jobs', {
    method: 'POST',
    body: JSON.stringify({ wallCode }),
  });
}

export function getRouteSettingAssets() {
  return apiRequest<{ items: HoldAssetDefinition[]; nextCursor: string | null }>(
    '/wall-setting-jobs/assets?limit=100',
  );
}

export function lockWallSettingJob(jobId: string, requestKey: string) {
  return jobAction(jobId, 'lock', requestKey);
}

export function cancelWallSettingJob(jobId: string, requestKey: string) {
  return jobAction(jobId, 'cancel', requestKey);
}

export function completeWallSettingJob(jobId: string, requestKey: string) {
  return jobAction(jobId, 'complete', requestKey);
}

function jobAction(jobId: string, action: 'lock' | 'cancel' | 'complete', requestKey: string) {
  return apiRequest<WallSettingJob>(`/wall-setting-jobs/${encodeURIComponent(jobId)}/${action}`, {
    method: 'POST',
    body: JSON.stringify({ requestKey }),
  });
}

export function getClimbObservations(wallCode = 'W06') {
  const query = new URLSearchParams({ wallCode });
  return apiRequest<{ items: ClimbObservation[]; nextCursor: string | null }>(
    `/climb-observations?${query.toString()}`,
  ).then((page) => page.items);
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
