import { apiRequest, apiRequestBlobResponse } from '../../lib/api';

export interface CameraLiveConfiguration {
  id: string;
  name: string;
  enabled: boolean;
  connectionStatus: 'ONLINE' | 'OFFLINE' | 'UNKNOWN';
  probe: {
    status: 'ONLINE' | 'OFFLINE' | 'UNKNOWN';
    checkedAt: string;
    latencyMs: number | null;
    bytesReceived: number;
    protocol: 'HTTPS-FLV';
    error?: string;
  };
  device: {
    manufacturer: string;
    model: string;
    channelId: string;
  };
  player: {
    kind: 'PLATFORM_IFRAME';
    url: string;
    resourceUrl: string;
    transport: 'WSS-FLV';
    codec: 'H264';
  };
  caveat: string;
}

export const getCameraLiveConfiguration = () => apiRequest<CameraLiveConfiguration>('/camera/live');

export interface CameraObservation {
  id: string;
  outcome: 'COMPLETED' | 'FAILED' | 'ABANDONED' | 'UNKNOWN';
  observedAt: string;
  source: 'CAMERA';
  climberKey: string | null;
  route: { id: string; code: string; name: string; color: string };
  routeVersion: { id: string; versionNumber: number };
  wallSegment: { id: string; code: string; name: string } | null;
  analysis: {
    confidence?: number;
    requiresReview?: boolean;
    failureReasons?: string[];
  } | null;
}

export const getCameraObservations = () =>
  apiRequest<{ items: CameraObservation[] }>('/camera/observations?pageSize=12');

export interface CameraRoutePoint {
  x: number;
  y: number;
}

export interface CameraRouteHold {
  id: string;
  x: number;
  y: number;
  width: number;
  height: number;
  /** Normalized outer contour. Older saved definitions may not have one. */
  polygon?: CameraRoutePoint[];
  /** Reserved for segmented holds with real cut-outs. */
  holes?: CameraRoutePoint[][];
  colorHex: string;
  colorCluster: string;
  confidence?: number;
  source?: 'AUTO_COLOR' | 'PROMPT_SEGMENTATION' | 'MANUAL';
  modelVersion?: string;
}

export interface CameraRouteDefinition {
  id: string;
  cameraKey: string;
  revision: number;
  route: { id: string; code: string; name: string; color: string };
  routeVersion: { id: string; versionNumber: number; status: string };
  wallSegment: { id: string; code: string; name: string };
  reference: { width: number; height: number };
  roi: CameraRoi;
  holds: CameraRouteHold[];
  startHoldIds: string[];
  finishHoldIds: string[];
  updatedAt: string;
}

export interface CameraRoi {
  x1: number;
  y1: number;
  x2: number;
  y2: number;
}

export interface CameraRouteOption {
  id: string;
  code: string;
  name: string;
  status: 'DRAFT' | 'READY_FOR_INSTALL' | 'PUBLISHED' | 'INACTIVE';
  color: string;
  grade: string;
  version: {
    id: string;
    number: number;
    status: string;
    wallSegmentIds: string[];
  };
}

export interface CameraRouteWorkspace {
  cameraKey: string;
  routes: CameraRouteOption[];
  wallSegments: Array<{ id: string; code: string; name: string }>;
  definitions: CameraRouteDefinition[];
}

export interface SaveCameraRouteDefinitionInput {
  routeId: string;
  routeVersionId: string;
  wallSegmentId: string;
  referenceWidth: number;
  referenceHeight: number;
  roi: CameraRoi;
  holds: CameraRouteHold[];
  startHoldIds: string[];
  finishHoldIds: string[];
}

export const getCameraRouteWorkspace = () =>
  apiRequest<CameraRouteWorkspace>('/camera/route-definitions');

export async function getCameraSnapshot() {
  const response = await apiRequestBlobResponse(`/camera/snapshot?t=${Date.now()}`);
  return {
    blob: await response.blob(),
    capturedAt: response.headers.get('x-camera-snapshot-captured-at'),
    stale: response.headers.get('x-camera-snapshot-stale') === 'true',
  };
}

export const saveCameraRouteDefinition = (input: SaveCameraRouteDefinitionInput) =>
  apiRequest<CameraRouteDefinition>('/camera/route-definitions', {
    method: 'PUT',
    body: JSON.stringify(input),
  });
