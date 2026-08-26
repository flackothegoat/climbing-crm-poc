import { MAX_HOLD_QUANTITY } from './hold-domain.constants';

export { MAX_HOLD_QUANTITY } from './hold-domain.constants';

export type InventoryAdjustment =
  | { valid: false; error: string }
  | {
      valid: true;
      targetQuantity: number;
      quantityDelta: number;
      changeText: string;
      tone: 'increase' | 'decrease' | 'unchanged';
    };

export function calculateInventoryAdjustment(
  currentQuantity: number,
  input: string,
): InventoryAdjustment {
  if (!/^\d+$/.test(input.trim())) return { valid: false, error: '请输入完整的实际数量' };
  const targetQuantity = Number(input);
  if (!Number.isSafeInteger(targetQuantity) || targetQuantity > MAX_HOLD_QUANTITY) {
    return { valid: false, error: `实际数量不能超过 ${MAX_HOLD_QUANTITY.toLocaleString()} 颗` };
  }
  const quantityDelta = targetQuantity - currentQuantity;
  if (!quantityDelta) {
    return {
      valid: true,
      targetQuantity,
      quantityDelta,
      changeText: '数量没有变化',
      tone: 'unchanged',
    };
  }
  const increase = quantityDelta > 0;
  return {
    valid: true,
    targetQuantity,
    quantityDelta,
    changeText: `${increase ? '增加' : '减少'} ${Math.abs(quantityDelta)} 颗`,
    tone: increase ? 'increase' : 'decrease',
  };
}

export function stepTargetQuantity(input: string, change: -1 | 1): string {
  const current = /^\d+$/.test(input.trim()) ? Number(input) : 0;
  return String(Math.min(MAX_HOLD_QUANTITY, Math.max(0, current + change)));
}
