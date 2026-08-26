import { RfidInventoryMatchStatus, RfidTagStatus } from '@prisma/client';
import { describe, expect, it } from 'vitest';
import {
  classifyRfidRead,
  epcFrequencies,
  rfidReadFingerprint,
  type KnownRfidRead,
} from './rfid-inventory-matching';

const knownTag: KnownRfidRead = {
  id: 'tag-1',
  organizationId: 'org-1',
  status: RfidTagStatus.ACTIVE,
  bindings: [
    {
      holdUnitId: 'unit-1',
      holdUnit: {
        ownerOrganizationId: 'org-1',
        currentCustodianOrganizationId: 'org-1',
      },
    },
  ],
};

describe('RFID inventory matching', () => {
  it('优先按会话快照判定位置符合', () => {
    expect(
      classifyRfidRead('E2801190', { rfidTagId: 'tag-1', holdUnitId: 'unit-1' }, knownTag, 'org-1'),
    ).toMatchObject({ matchStatus: RfidInventoryMatchStatus.MATCHED_EXPECTED });
  });

  it('本组织可见但不在快照中的岩点标记为位置异常', () => {
    expect(classifyRfidRead('E2801190', undefined, knownTag, 'org-1')).toMatchObject({
      matchStatus: RfidInventoryMatchStatus.MATCHED_UNEXPECTED,
      holdUnitId: 'unit-1',
    });
  });

  it('不向当前组织暴露其他组织标签的资产信息', () => {
    const foreign = {
      ...knownTag,
      organizationId: 'org-2',
      bindings: [
        {
          holdUnitId: 'unit-2',
          holdUnit: {
            ownerOrganizationId: 'org-2',
            currentCustodianOrganizationId: 'org-2',
          },
        },
      ],
    };
    expect(classifyRfidRead('E2801190', undefined, foreign, 'org-1')).toEqual({
      epc: 'E2801190',
      matchStatus: RfidInventoryMatchStatus.UNKNOWN,
      rfidTagId: null,
      holdUnitId: null,
    });
  });

  it('幂等指纹同时包含 EPC 和读取次数', () => {
    const first = epcFrequencies(['E2801190', 'E2801190', 'ABCD1234']);
    const reordered = epcFrequencies(['ABCD1234', 'E2801190', 'E2801190']);
    const changed = epcFrequencies(['ABCD1234', 'E2801190']);
    expect(rfidReadFingerprint(first)).toBe(rfidReadFingerprint(reordered));
    expect(rfidReadFingerprint(first)).not.toBe(rfidReadFingerprint(changed));
  });
});
