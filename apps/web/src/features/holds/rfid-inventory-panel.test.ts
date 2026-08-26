import { describe, expect, it } from 'vitest';
import { parseEpcs } from './rfid-inventory-panel';

describe('RFID inventory input', () => {
  it('支持读写器常见的换行、空格和中英文分隔符', () => {
    expect(parseEpcs('E2801190\nABCD1234, 01020304；A1B2C3D4')).toEqual([
      'E2801190',
      'ABCD1234',
      '01020304',
      'A1B2C3D4',
    ]);
  });
});
