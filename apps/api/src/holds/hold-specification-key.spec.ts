import { HoldMountingType, HoldSizeClass } from '@prisma/client';
import { describe, expect, it } from 'vitest';
import { buildProductKey } from './hold-specification-key';

describe('岩点规格唯一键', () => {
  it('忽略无意义的大小写和多余空格', () => {
    const base = {
      productName: 'Wave 01',
      manufacturer: 'Example Holds',
      sizeClass: HoldSizeClass.S,
      mountingType: HoldMountingType.BOLT_ON,
      widthMm: 80,
      heightMm: null,
      depthMm: 30,
    };
    expect(buildProductKey(base)).toBe(
      buildProductKey({ ...base, productName: '  wave   01 ', manufacturer: 'EXAMPLE HOLDS' }),
    );
  });
});
