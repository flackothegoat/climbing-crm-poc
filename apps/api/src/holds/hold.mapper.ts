import type {
  HoldInventoryBalance,
  HoldAsset,
  HoldModelProcessingJob,
  HoldModel,
  HoldVariant,
  InventoryVerificationStatus,
  Prisma,
} from '@prisma/client';

type VariantWithInventory = HoldVariant & {
  inventory: HoldInventoryBalance | null;
  assets?: Array<HoldAsset & { sourceProcessingJob?: HoldModelProcessingJob | null }>;
};
type ModelWithSpecifications = HoldModel & { variants: VariantWithInventory[] };
export type CategoryWithSpecifications = Prisma.HoldCategoryGetPayload<{
  include: { models: { include: { variants: { include: { inventory: true } } } } };
}>;

export function toCategorySummary(category: CategoryWithSpecifications) {
  const specifications = category.models.flatMap((model) =>
    model.variants.map((variant) => toSpecification(model, variant)),
  );
  const activeSpecificationCount = specifications.filter((item) => item.status === 'ACTIVE').length;
  return {
    id: category.id,
    code: category.code,
    name: category.name,
    gripType: category.gripType,
    description: category.description,
    source: category.source,
    status: category.status,
    specificationCount: specifications.length,
    activeSpecificationCount,
    stoppedSpecificationCount: specifications.length - activeSpecificationCount,
    inventory: sumInventory(specifications.map((item) => item.inventory)),
    specifications,
    createdAt: category.createdAt.toISOString(),
    updatedAt: category.updatedAt.toISOString(),
  };
}

export function toSpecification(model: HoldModel, variant: VariantWithInventory) {
  return {
    id: variant.id,
    productModelId: model.id,
    productName: model.name,
    manufacturer: model.brand,
    style: model.style,
    sizeClass: model.sizeClass,
    widthMm: model.widthMm,
    heightMm: model.heightMm,
    depthMm: model.depthMm,
    mountingType: model.mountingType,
    color: variant.color,
    sku: variant.sku,
    status: variant.status,
    assets: (variant.assets ?? []).map(toAssetSummary),
    inventory: inventoryValues(variant.inventory),
  };
}

function toAssetSummary(
  asset: HoldAsset & { sourceProcessingJob?: HoldModelProcessingJob | null },
) {
  return {
    id: asset.id,
    scanId: asset.scanId,
    kind: asset.kind,
    status: asset.status,
    originalFileName: asset.originalFileName,
    contentType: asset.contentType,
    sizeBytes: asset.sizeBytes,
    metadata: asset.metadata,
    sourceAssetId: asset.sourceAssetId,
    processingJob: asset.sourceProcessingJob
      ? {
          id: asset.sourceProcessingJob.id,
          status: asset.sourceProcessingJob.status,
          attemptCount: asset.sourceProcessingJob.attemptCount,
          processorVersion: asset.sourceProcessingJob.processorVersion,
          sourceAssetId: asset.sourceProcessingJob.sourceAssetId,
          outputAssetId: asset.sourceProcessingJob.outputAssetId,
          errorCode: asset.sourceProcessingJob.errorCode,
          errorMessage: asset.sourceProcessingJob.errorMessage,
          report: asset.sourceProcessingJob.report,
          createdAt: asset.sourceProcessingJob.createdAt.toISOString(),
          updatedAt: asset.sourceProcessingJob.updatedAt.toISOString(),
        }
      : null,
    createdAt: asset.createdAt.toISOString(),
  };
}

export function inventoryValues(inventory: HoldInventoryBalance | null) {
  const values = inventory ?? emptyInventory();
  const totalQuantity =
    values.warehouseQuantity +
    values.installedQuantity +
    values.reservedQuantity +
    values.maintenanceQuantity;
  return {
    warehouseQuantity: values.warehouseQuantity,
    installedQuantity: values.installedQuantity,
    reservedQuantity: values.reservedQuantity,
    maintenanceQuantity: values.maintenanceQuantity,
    verificationStatus: values.verificationStatus,
    totalQuantity,
    version: 'version' in values ? values.version : 0,
  };
}

function sumInventory(inventories: ReturnType<typeof inventoryValues>[]) {
  return inventories.reduce((total, value) => {
    total.warehouseQuantity += value.warehouseQuantity;
    total.installedQuantity += value.installedQuantity;
    total.reservedQuantity += value.reservedQuantity;
    total.maintenanceQuantity += value.maintenanceQuantity;
    total.totalQuantity += value.totalQuantity;
    return total;
  }, emptyInventoryTotal());
}

function emptyInventoryTotal() {
  return {
    warehouseQuantity: 0,
    installedQuantity: 0,
    reservedQuantity: 0,
    maintenanceQuantity: 0,
    totalQuantity: 0,
  };
}

function emptyInventory(): {
  warehouseQuantity: number;
  installedQuantity: number;
  reservedQuantity: number;
  maintenanceQuantity: number;
  verificationStatus: InventoryVerificationStatus;
} {
  return {
    warehouseQuantity: 0,
    installedQuantity: 0,
    reservedQuantity: 0,
    maintenanceQuantity: 0,
    verificationStatus: 'UNVERIFIED',
  };
}

export function inventoryTotal(inventory: HoldInventoryBalance | null): number {
  return inventoryValues(inventory).totalQuantity;
}

export function hasSpecifications(model: ModelWithSpecifications): boolean {
  return model.variants.length > 0;
}
