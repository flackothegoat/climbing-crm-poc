import { apiBaseUrl, apiRequest } from '../../lib/api';
import type { ClimbingColor } from '../common/climbing-colors';

export type RouteStatus = 'DRAFT' | 'READY_FOR_INSTALL' | 'PUBLISHED' | 'INACTIVE' | 'REMOVED';
export type FeedbackOutcome = 'COMPLETED' | 'ATTEMPTING';
export type DifficultyVote = 'EASIER' | 'AS_EXPECTED' | 'HARDER';
export type EnjoymentVote = 'DISLIKE' | 'NEUTRAL' | 'LIKE';

export interface RouteWallSegment {
  id: string;
  code: string;
  name: string;
  geometryCalibrated?: boolean;
}

export interface OperationalRoute {
  id: string;
  code: string;
  name: string;
  description: string | null;
  status: RouteStatus;
  dataSource: 'DUMMY' | 'MANUAL' | 'IMPORTED';
  color: ClimbingColor;
  grade: string;
  gradeSystem: string | null;
  styleTags: string[];
  setter: { id: string; displayName: string | null; jobTitle: string | null } | null;
  wallSegments: RouteWallSegment[];
  version: {
    id: string;
    number: number;
    status: 'DRAFT' | 'PUBLISHED' | 'RETIRED';
    hasPhoto: boolean;
    has3dPlacements: boolean;
  } | null;
  expectedRetireAt: string | null;
  publishedAt: string | null;
  retiredAt: string | null;
  feedbackCount: number;
  observationCount: number;
  publicToken: string | null;
  updatedAt: string;
  actions: {
    canEdit: boolean;
    canPublish: boolean;
    canRetire: boolean;
    canRestore: boolean;
    canDelete: boolean;
  };
}

export interface RouteContext {
  areas: Array<{
    id: string;
    code: string;
    name: string;
    floorLabel: string | null;
    segments: RouteWallSegment[];
  }>;
  setters: Array<{ id: string; displayName: string | null; jobTitle: string | null }>;
}

export interface RouteInput {
  code: string;
  name: string;
  description?: string | null;
  color: ClimbingColor;
  grade: string;
  gradeSystem: string;
  styleTags: string[];
  setterMembershipId?: string | null;
  wallSegmentIds: string[];
  expectedRetireAt?: string | null;
}

export type CreateRouteInput = Omit<RouteInput, 'code'> & { code?: string };

export interface RouteAnalyticsItem {
  routeId: string;
  routeCode: string;
  routeName: string;
  routeStatus: RouteStatus;
  routeVersionId: string;
  versionNumber: number;
  grade: string | null;
  color: ClimbingColor | null;
  wallSegments: RouteWallSegment[];
  publishedAt: string | null;
  retiredAt: string | null;
  sampleSize: number;
  respondentCompletionRate: number | null;
  difficulty: { easier: number; expected: number; harder: number; expectedRate: number | null };
  enjoyment: { likes: number; likeRate: number | null };
  safetyConcernCount: number;
  confidence: 'SUFFICIENT' | 'EARLY_SIGNAL' | 'INSUFFICIENT';
  recommendation: { code: string; label: string };
}

export interface RouteAnalytics {
  scope: { from: string | null; to: string | null; metricNotice: string };
  totals: { activeRoutes: number; routeVersions: number; feedback: number; safetyConcerns: number };
  items: RouteAnalyticsItem[];
}

export interface PublicRoute {
  availability: 'ACTIVE' | 'RETIRED';
  gymName: string;
  code: string;
  name: string;
  description: string | null;
  color: ClimbingColor;
  grade: string;
  gradeSystem: string | null;
  styleTags: string[];
  setterName: string | null;
  wallSegments: Array<{ code: string; name: string }>;
  publishedAt: string | null;
  retiredAt: string | null;
  hasPhoto: boolean;
  metricNotice: string;
}

export const getRouteContext = () => apiRequest<RouteContext>('/route-operations/context');
export const getOperationalRoutes = () =>
  apiRequest<{ items: OperationalRoute[] }>('/route-operations').then((page) => page.items);
export const getRouteAnalytics = () => apiRequest<RouteAnalytics>('/route-operations/analytics');

export const createOperationalRoute = (input: CreateRouteInput) =>
  apiRequest<OperationalRoute>('/route-operations', {
    method: 'POST',
    body: JSON.stringify(input),
  });

export const updateOperationalRoute = (routeId: string, input: Partial<RouteInput>) =>
  apiRequest<OperationalRoute>(`/route-operations/${encodeURIComponent(routeId)}`, {
    method: 'PATCH',
    body: JSON.stringify(input),
  });

export const publishOperationalRoute = (routeId: string) =>
  apiRequest<OperationalRoute>(`/route-operations/${encodeURIComponent(routeId)}/publish`, {
    method: 'POST',
  });

export const retireOperationalRoute = (routeId: string) =>
  apiRequest<OperationalRoute>(`/route-operations/${encodeURIComponent(routeId)}/retire`, {
    method: 'POST',
  });

export const restoreOperationalRoute = (routeId: string) =>
  apiRequest<OperationalRoute>(`/route-operations/${encodeURIComponent(routeId)}/restore`, {
    method: 'POST',
  });

export const deleteOperationalRoute = (routeId: string) =>
  apiRequest<{ id: string; status: 'REMOVED' }>(
    `/route-operations/${encodeURIComponent(routeId)}`,
    { method: 'DELETE' },
  );

export async function uploadRoutePhoto(routeId: string, file: File) {
  const form = new FormData();
  form.append('file', file);
  return apiRequest<{ id: string }>(`/route-operations/${encodeURIComponent(routeId)}/photo`, {
    method: 'POST',
    body: form,
  });
}

export const routePhotoUrl = (routeId: string) =>
  `${apiBaseUrl}/route-operations/${encodeURIComponent(routeId)}/photo`;

export const createOperationalWall = (input: {
  areaCode: string;
  areaName: string;
  floorLabel?: string;
  segmentCode: string;
  segmentName: string;
}) => apiRequest('/route-operations/walls', { method: 'POST', body: JSON.stringify(input) });

export const getPublicRoute = (token: string) =>
  apiRequest<PublicRoute>(`/public/routes/${encodeURIComponent(token)}`);

export const publicRoutePhotoUrl = (token: string) =>
  `${apiBaseUrl}/public/routes/${encodeURIComponent(token)}/photo`;

export const submitRouteFeedback = (
  token: string,
  input: {
    outcome: FeedbackOutcome;
    difficulty: DifficultyVote;
    enjoyment: EnjoymentVote;
    safetyConcern: boolean;
    comment?: string;
    anonymousSessionId: string;
    requestKey: string;
  },
) =>
  apiRequest<{ id: string; submittedAt: string; accepted: true }>(
    `/public/routes/${encodeURIComponent(token)}/feedback`,
    { method: 'POST', body: JSON.stringify(input) },
  );
