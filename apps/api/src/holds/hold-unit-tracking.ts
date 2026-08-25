import { ConflictException } from '@nestjs/common';
import { HoldTrackingMode, HoldUnitOperationalStatus, Prisma } from '@prisma/client';

export interface InventoryQuantities {
  warehouseQuantity: number;
  installedQuantity: number;
  reservedQuantity: number;
  maintenanceQuantity: number;
}

export async function assertInventoryCoversTrackedUnits(
  transaction: Prisma.TransactionClient,
  variantId: string,
  quantities: InventoryQuantities,
): Promise<number> {
  const unitCount = await countTrackedUnits(transaction, variantId);
  if (totalInventoryQuantity(quantities) < unitCount) {
    throw new ConflictException(
      `该规格已有 ${unitCount} 颗物理岩点，汇总库存不能调整到更低；请先处理对应单体资产`,
    );
  }
  return unitCount;
}

export async function refreshHoldTrackingMode(
  transaction: Prisma.TransactionClient,
  variantId: string,
  quantities: InventoryQuantities,
  knownUnitCount?: number,
): Promise<HoldTrackingMode> {
  const unitCount = knownUnitCount ?? (await countTrackedUnits(transaction, variantId));
  const total = totalInventoryQuantity(quantities);
  const mode =
    unitCount === 0
      ? HoldTrackingMode.QUANTITY
      : unitCount === total
        ? HoldTrackingMode.SERIALIZED
        : HoldTrackingMode.HYBRID;
  await transaction.holdVariant.update({ where: { id: variantId }, data: { trackingMode: mode } });
  return mode;
}

export function totalInventoryQuantity(quantities: InventoryQuantities): number {
  return (
    quantities.warehouseQuantity +
    quantities.installedQuantity +
    quantities.reservedQuantity +
    quantities.maintenanceQuantity
  );
}

function countTrackedUnits(transaction: Prisma.TransactionClient, variantId: string) {
  return transaction.holdUnit.count({
    where: {
      holdVariantId: variantId,
      operationalStatus: { not: HoldUnitOperationalStatus.RETIRED },
    },
  });
}
