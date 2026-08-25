import { apiRequest, apiRequestBlob } from '../../lib/api';
import type { ClimbingColor } from '../common/climbing-colors';

export type HoldStatus = 'ACTIVE' | 'ARCHIVED';
export type HoldCategorySource = 'DEFAULT' | 'CUSTOM';
export type HoldGripType =
  'JUG' | 'CRIMP' | 'SLOPER' | 'PINCH' | 'POCKET' | 'FOOTHOLD' | 'VOLUME' | 'OTHER';
export type HoldSizeClass = 'XS' | 'S' | 'M' | 'L' | 'XL' | 'XXL';
export type HoldMountingType = 'BOLT_ON' | 'SCREW_ON' | 'DUAL' | 'UNKNOWN';
export type InventoryBucket = 'WAREHOUSE' | 'INSTALLED' | 'RESERVED' | 'MAINTENANCE';
export type HoldTrackingMode = 'QUANTITY' | 'HYBRID' | 'SERIALIZED';
export type HoldUnitPhysicalStatus = 'WAREHOUSE' | 'INSTALLED' | 'IN_TRANSIT' | 'UNKNOWN';
export type HoldUnitOperationalStatus = 'ACTIVE' | 'MAINTENANCE' | 'LOST' | 'RETIRED';
export type HoldAssetKind =
  | 'MODEL_SOURCE'
  | 'MODEL_3D'
  | 'MODEL_PREVIEW'
  | 'PHOTO_FRONT'
  | 'PHOTO_BACK'
  | 'PHOTO_MEASUREMENT'
  | 'PHOTO_OTHER';

export type HoldModelProcessingStatus =
  'QUEUED' | 'PROCESSING' | 'COMPLETED' | 'NEEDS_REVIEW' | 'FAILED' | 'CANCELLED';

export interface HoldModelProcessingJob {
  id: string;
  status: HoldModelProcessingStatus;
  attemptCount: number;
  processorVersion: number;
  sourceAssetId: string;
  outputAssetId: string | null;
  errorCode: string | null;
  errorMessage: string | null;
  report: Record<string, unknown> | null;
  createdAt: string;
  updatedAt: string;
}

export interface HoldAsset {
  id: string;
  scanId: string;
  kind: HoldAssetKind;
  status: 'READY' | 'FAILED' | 'DELETED';
  originalFileName: string;
  contentType: string;
  sizeBytes: number;
  checksumSha256?: string;
  metadata: Record<string, number> | null;
  sourceAssetId: string | null;
  processingJob?: HoldModelProcessingJob | null;
  createdAt: string;
}

export interface HoldInventory {
  warehouseQuantity: number;
  installedQuantity: number;
  reservedQuantity: number;
  maintenanceQuantity: number;
  totalQuantity: number;
  verificationStatus?: 'UNVERIFIED' | 'PARTIAL' | 'VERIFIED';
  version: number;
}

export interface HoldLifecycle {
  canDelete: boolean;
  canStop: boolean;
  canRestore: boolean;
}

export interface HoldSpecification {
  id: string;
  productModelId: string;
  productName: string;
  manufacturer: string | null;
  style: string | null;
  sizeClass: HoldSizeClass;
  widthMm: number | null;
  heightMm: number | null;
  depthMm: number | null;
  mountingType: HoldMountingType;
  color: ClimbingColor;
  sku: string | null;
  status: HoldStatus;
  trackingMode: HoldTrackingMode;
  assets: HoldAsset[];
  inventory: HoldInventory;
  lifecycle?: HoldLifecycle;
}

export interface HoldUnit {
  id: string;
  assetCode: string;
  physicalStatus: HoldUnitPhysicalStatus;
  operationalStatus: HoldUnitOperationalStatus;
  ownerOrganizationId: string;
  currentCustodianOrganizationId: string;
  facility: { id: string; code: string; name: string };
  tag: {
    id: string;
    epc: string;
    tid: string | null;
    technology: 'UHF_EPC_GEN2';
    status: 'ACTIVE' | 'LOST' | 'DAMAGED' | 'REPLACED';
  } | null;
  version: number;
  createdAt: string;
  updatedAt: string;
}

export interface HoldUnitTrackingSummary {
  mode: HoldTrackingMode;
  registeredQuantity: number;
  taggedQuantity: number;
  unregisteredQuantity: number;
  warehouseRegistered: number;
  warehouseRemaining: number;
  installedRegistered: number;
  installedRemaining: number;
  totalQuantity: number;
}

export interface HoldUnitListResponse {
  items: HoldUnit[];
  total: number;
  page: number;
  pageSize: number;
  tracking: HoldUnitTrackingSummary;
}

export interface HoldCategory {
  id: string;
  code: string;
  name: string;
  gripType: HoldGripType;
  description: string | null;
  source: HoldCategorySource;
  status: HoldStatus;
  specificationCount: number;
  activeSpecificationCount: number;
  stoppedSpecificationCount: number;
  inventory: HoldInventory;
  specifications: HoldSpecification[];
  createdAt: string;
  updatedAt: string;
}

export interface HoldMovement {
  id: string;
  type: string;
  bucket: InventoryBucket;
  quantityDelta: number;
  beforeQuantity: number;
  afterQuantity: number;
  note: string | null;
  occurredAt: string;
  specification: { productName: string; color: ClimbingColor };
  actorName: string;
  reversed: boolean;
  reversalOfMovementId: string | null;
  canReverse: boolean;
}

export interface HoldCategoryDetail extends HoldCategory {
  movements: HoldMovement[];
  lifecycle: HoldLifecycle;
}

export interface HoldInventorySummary {
  categoryCount: number;
  specificationCount: number;
  warehouseQuantity: number;
  installedQuantity: number;
  reservedQuantity: number;
  maintenanceQuantity: number;
  unverifiedCount: number;
}

export interface HoldCategoryListResponse {
  items: HoldCategory[];
  total: number;
  page: number;
  pageSize: number;
}

export interface HoldInitializationBatch {
  id: string;
  name: string;
  status: 'ACTIVE' | 'COMPLETED' | 'CANCELLED';
  entryCount: number;
  draftScanCount: number;
  warehouseQuantity: number;
  installedQuantity: number;
  specificationIds: string[];
  createdAt: string;
}

export interface HoldScan {
  id: string;
  categoryId: string;
  specificationId: string | null;
  initializationBatchId: string | null;
  mode: 'CREATE_SPECIFICATION' | 'ENRICH_SPECIFICATION';
  status: 'DRAFT' | 'COMPLETED' | 'CANCELLED';
  assets: HoldAsset[];
}

export interface HoldCategoryInput {
  code: string;
  name: string;
  gripType: HoldGripType;
  description?: string | null;
}

export interface HoldSpecificationInput {
  productName: string;
  manufacturer: string;
  style?: string | null;
  sizeClass: HoldSizeClass;
  widthMm?: number | null;
  heightMm?: number | null;
  depthMm?: number | null;
  mountingType: HoldMountingType;
  color: ClimbingColor;
  sku?: string | null;
}

export async function getHoldCategories(search: string, gripType: string, showStopped: boolean) {
  const query = new URLSearchParams({
    status: showStopped ? 'ALL' : 'ACTIVE',
    pageSize: '100',
  });
  if (search) query.set('search', search);
  if (gripType) query.set('gripType', gripType);
  return apiRequest<HoldCategoryListResponse>(`/holds/categories?${query.toString()}`, {
    cacheTtlMs: 10_000,
  });
}

export const getHoldSummary = () =>
  apiRequest<HoldInventorySummary>('/holds/summary', { cacheTtlMs: 30_000 });
export const getHoldCategory = (id: string) =>
  apiRequest<HoldCategoryDetail>(`/holds/categories/${id}`, { cacheTtlMs: 10_000 });

export function createHoldCategory(input: HoldCategoryInput) {
  return apiRequest<HoldCategory>('/holds/categories', {
    method: 'POST',
    body: JSON.stringify(input),
  });
}

export const ensureDefaultHoldCategories = () =>
  apiRequest<{ createdCount: number }>('/holds/categories/defaults', { method: 'POST' });

export function updateHoldCategory(id: string, input: Partial<HoldCategoryInput>) {
  return apiRequest(`/holds/categories/${id}`, { method: 'PATCH', body: JSON.stringify(input) });
}

export function addHoldSpecification(categoryId: string, input: HoldSpecificationInput) {
  return apiRequest<HoldSpecification>(`/holds/categories/${categoryId}/specifications`, {
    method: 'POST',
    body: JSON.stringify(input),
  });
}

export function createHoldRecord(
  categoryId: string,
  specification: HoldSpecificationInput,
  initialization?: InitializationCounts & { batchId: string },
) {
  return apiRequest<HoldSpecification>(`/holds/categories/${categoryId}/records`, {
    method: 'POST',
    body: JSON.stringify({ specification, initialization }),
  });
}

export const getActiveHoldInitialization = () =>
  apiRequest<HoldInitializationBatch | null>('/holds/initialization/active', {
    cacheTtlMs: 15_000,
  });

export const startHoldInitialization = (name: string) =>
  apiRequest<HoldInitializationBatch>('/holds/initialization/batches', {
    method: 'POST',
    body: JSON.stringify({ name }),
  });

export const completeHoldInitialization = (batchId: string) =>
  apiRequest<void>(`/holds/initialization/batches/${batchId}/complete`, { method: 'POST' });

export const cancelHoldInitialization = (batchId: string) =>
  apiRequest<void>(`/holds/initialization/batches/${batchId}`, { method: 'DELETE' });

export const createNewHoldCapture = (categoryId: string, initializationBatchId?: string) =>
  apiRequest<HoldScan>('/holds/scans', {
    method: 'POST',
    body: JSON.stringify({
      mode: 'CREATE_SPECIFICATION',
      categoryId,
      initializationBatchId,
    }),
  });

export const createHoldModelAttachment = (specificationId: string) =>
  apiRequest<HoldScan>('/holds/scans', {
    method: 'POST',
    body: JSON.stringify({ mode: 'ENRICH_SPECIFICATION', specificationId }),
  });

export async function uploadHoldScanAsset(scanId: string, kind: HoldAssetKind, file: File) {
  const formData = new FormData();
  formData.append('file', file);
  return apiRequest<HoldAsset>(`/holds/scans/${scanId}/assets?kind=${kind}`, {
    method: 'POST',
    body: formData,
  });
}

export async function uploadHoldModelPreview(
  modelAssetId: string,
  generationVersion: number,
  file: File,
) {
  const formData = new FormData();
  formData.append('file', file);
  return apiRequest<HoldAsset>(
    `/holds/assets/${modelAssetId}/preview?generationVersion=${generationVersion}`,
    { method: 'POST', body: formData },
  );
}

export function finalizeHoldScan(
  scanId: string,
  specification: HoldSpecificationInput,
  inventory?: InitializationCounts,
) {
  return apiRequest<{ specificationId: string; productModelId: string }>(
    `/holds/scans/${scanId}/finalize`,
    { method: 'POST', body: JSON.stringify({ specification, inventory }) },
  );
}

export const completeHoldModelAttachment = (scanId: string) =>
  apiRequest<void>(`/holds/scans/${scanId}/complete-attachment`, { method: 'POST' });

export const cancelHoldScan = (scanId: string) =>
  apiRequest<void>(`/holds/scans/${scanId}`, { method: 'DELETE' });

export const getHoldModelProcessing = (scanId: string) =>
  apiRequest<HoldModelProcessingJob>(`/holds/scans/${scanId}/model-processing`);

export const retryHoldModelProcessing = (jobId: string) =>
  apiRequest<HoldModelProcessingJob>(`/holds/model-processing/${jobId}/retry`, {
    method: 'POST',
  });

export function initializeHoldSpecification(
  specificationId: string,
  batchId: string,
  counts: InitializationCounts,
) {
  return apiRequest(`/holds/specifications/${specificationId}/initialize`, {
    method: 'POST',
    body: JSON.stringify({ batchId, ...counts }),
  });
}

export const getHoldAssetBlob = (assetId: string) =>
  apiRequestBlob(`/holds/assets/${assetId}/content`);

export function updateHoldSpecification(id: string, input: Partial<HoldSpecificationInput>) {
  return apiRequest(`/holds/specifications/${id}`, {
    method: 'PATCH',
    body: JSON.stringify(input),
  });
}

export function recordStockMovement(
  specificationId: string,
  input:
    | {
        requestKey: string;
        type: 'RECEIPT';
        bucket: 'WAREHOUSE';
        quantityDelta: number;
        note?: string | null;
      }
    | {
        requestKey: string;
        type: 'ADJUSTMENT';
        bucket: InventoryBucket;
        targetQuantity: number;
        expectedVersion: number;
        note: string;
      },
) {
  return apiRequest(`/holds/specifications/${specificationId}/movements`, {
    method: 'POST',
    body: JSON.stringify(input),
  });
}

export const getHoldUnits = (specificationId: string) =>
  apiRequest<HoldUnitListResponse>(`/holds/specifications/${specificationId}/units?pageSize=100`);

export function registerHoldUnits(
  specificationId: string,
  input: {
    requestKey: string;
    quantity: number;
    physicalStatus: 'WAREHOUSE' | 'INSTALLED';
  },
) {
  return apiRequest(`/holds/specifications/${specificationId}/units/batches`, {
    method: 'POST',
    body: JSON.stringify(input),
  });
}

export function bindHoldUnitTag(
  unitId: string,
  input: { requestKey: string; epc: string; tid?: string },
) {
  return apiRequest<HoldUnit>(`/holds/units/${unitId}/tag`, {
    method: 'POST',
    body: JSON.stringify(input),
  });
}

export const stopHoldCategory = (id: string) =>
  apiRequest<void>(`/holds/categories/${id}/stop`, { method: 'POST' });
export const restoreHoldCategory = (id: string) =>
  apiRequest<void>(`/holds/categories/${id}/restore`, { method: 'POST' });
export const deleteUnusedHoldCategory = (id: string) =>
  apiRequest<void>(`/holds/categories/${id}`, { method: 'DELETE' });

export const stopHoldSpecification = (id: string) =>
  apiRequest<void>(`/holds/specifications/${id}/stop`, { method: 'POST' });
export const restoreHoldSpecification = (id: string) =>
  apiRequest<void>(`/holds/specifications/${id}/restore`, { method: 'POST' });
export function permanentlyDeleteHoldSpecification(
  id: string,
  input: { expectedVersion: number; reason: string; confirmationText: string },
) {
  return apiRequest<void>(`/holds/specifications/${id}/permanent-delete`, {
    method: 'POST',
    body: JSON.stringify(input),
  });
}

export function reverseReceipt(movementId: string, reason: string) {
  return apiRequest(`/holds/movements/${movementId}/reverse`, {
    method: 'POST',
    body: JSON.stringify({ reason }),
  });
}

export interface InitializationCounts {
  warehouseQuantity: number;
  installedQuantity: number;
  note?: string | null;
}
