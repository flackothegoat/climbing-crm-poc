import { RfidInventoryMatchStatus, RfidTagStatus } from '@prisma/client';
import { createHash } from 'node:crypto';

export interface ExpectedRfidRead {
  rfidTagId: string;
  holdUnitId: string;
}

export interface KnownRfidRead {
  id: string;
  organizationId: string;
  status: RfidTagStatus;
  bindings: Array<{
    holdUnitId: string;
    holdUnit: {
      ownerOrganizationId: string;
      currentCustodianOrganizationId: string;
    };
  }>;
}

export function classifyRfidRead(
  epc: string,
  expected: ExpectedRfidRead | undefined,
  tag: KnownRfidRead | undefined,
  organizationId: string,
) {
  if (expected) {
    return {
      epc,
      matchStatus: RfidInventoryMatchStatus.MATCHED_EXPECTED,
      rfidTagId: expected.rfidTagId,
      holdUnitId: expected.holdUnitId,
    };
  }
  const binding = tag?.bindings[0];
  if (
    tag?.status === RfidTagStatus.ACTIVE &&
    binding &&
    (binding.holdUnit.ownerOrganizationId === organizationId ||
      binding.holdUnit.currentCustodianOrganizationId === organizationId)
  ) {
    return {
      epc,
      matchStatus: RfidInventoryMatchStatus.MATCHED_UNEXPECTED,
      rfidTagId: tag.id,
      holdUnitId: binding.holdUnitId,
    };
  }
  if (tag?.organizationId === organizationId) {
    return {
      epc,
      matchStatus: RfidInventoryMatchStatus.UNBOUND,
      rfidTagId: tag.id,
      holdUnitId: null,
    };
  }
  return {
    epc,
    matchStatus: RfidInventoryMatchStatus.UNKNOWN,
    rfidTagId: null,
    holdUnitId: null,
  };
}

export function epcFrequencies(epcs: string[]): Map<string, number> {
  const result = new Map<string, number>();
  for (const epc of epcs) result.set(epc, (result.get(epc) ?? 0) + 1);
  return result;
}

export function rfidReadFingerprint(frequencies: Map<string, number>): string {
  const ordered = [...frequencies.entries()].sort(([left], [right]) => left.localeCompare(right));
  return createHash('sha256').update(JSON.stringify(ordered)).digest('hex');
}
