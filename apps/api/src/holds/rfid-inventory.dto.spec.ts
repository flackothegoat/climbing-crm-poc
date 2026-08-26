import { describe, expect, it } from 'vitest';
import {
  parseCreateRfidInventorySession,
  parseIngestRfidInventoryReads,
  parseTransitionRfidInventorySession,
} from './rfid-inventory.dto';

describe('RFID inventory DTO', () => {
  it('统一 EPC 格式但保留批内重复读取', () => {
    const parsed = parseIngestRfidInventoryReads({
      requestKey: '11111111-1111-4111-8111-111111111111',
      epcs: ['e280-11:90', 'E2801190'],
    });
    expect(parsed.epcs).toEqual(['E2801190', 'E2801190']);
  });

  it('仅允许对仓库或已上墙建立盘点', () => {
    const base = {
      requestKey: '22222222-2222-4222-8222-222222222222',
      name: '仓库盘点',
    };
    expect(
      parseCreateRfidInventorySession({ ...base, targetPhysicalStatus: 'WAREHOUSE' }),
    ).toMatchObject({ targetPhysicalStatus: 'WAREHOUSE' });
    expect(() =>
      parseCreateRfidInventorySession({ ...base, targetPhysicalStatus: 'IN_TRANSIT' }),
    ).toThrow();
  });

  it('过期版本不能使用负数绕过', () => {
    expect(() => parseTransitionRfidInventorySession({ expectedVersion: -1 })).toThrow();
  });
});
