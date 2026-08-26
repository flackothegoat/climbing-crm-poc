import { describe, expect, it } from 'vitest';
import { calculateInventoryAdjustment, stepTargetQuantity } from './hold-stock-adjustment';

describe('calculateInventoryAdjustment', () => {
  it('把盘点后的实际数量转换为库存差额', () => {
    expect(calculateInventoryAdjustment(5, '3')).toMatchObject({
      valid: true,
      targetQuantity: 3,
      quantityDelta: -2,
      changeText: '减少 2 颗',
    });
    expect(calculateInventoryAdjustment(5, '8')).toMatchObject({
      valid: true,
      targetQuantity: 8,
      quantityDelta: 3,
      changeText: '增加 3 颗',
    });
  });

  it('识别无变化和无效数量', () => {
    expect(calculateInventoryAdjustment(5, '5')).toMatchObject({
      valid: true,
      quantityDelta: 0,
      tone: 'unchanged',
    });
    expect(calculateInventoryAdjustment(5, '-1').valid).toBe(false);
    expect(calculateInventoryAdjustment(5, '').valid).toBe(false);
  });

  it('加减按钮不会把实际数量调成负数', () => {
    expect(stepTargetQuantity('0', -1)).toBe('0');
    expect(stepTargetQuantity('5', 1)).toBe('6');
  });
});
