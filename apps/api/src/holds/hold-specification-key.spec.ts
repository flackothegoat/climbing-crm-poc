import { HoldMountingType, HoldSizeClass } from '@prisma/client';
import { describe, expect, it } from 'vitest';
import { buildColorKey, buildProductKey } from './hold-specification-key';

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

  it('颜色名称和色值共同确定颜色规格', () => {
    expect(buildColorKey({ colorName: ' 黄色 ', colorHex: '#D8F56C' })).toBe(
      buildColorKey({ colorName: '黄色', colorHex: '#d8f56c' }),
    );
    expect(buildColorKey({ colorName: '黄色', colorHex: '#D8F56C' })).not.toBe(
      buildColorKey({ colorName: '黄色', colorHex: '#F4D03F' }),
    );
  });
});
