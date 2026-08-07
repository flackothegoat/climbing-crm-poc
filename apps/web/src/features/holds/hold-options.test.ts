import { describe, expect, it } from 'vitest';
import {
  defaultCategoryDescription,
  formatCategoryDescription,
  formatGripLabel,
  gripEnglishLabel,
} from './hold-options';

describe('岩点抓握类型显示', () => {
  it('为每一种类型提供稳定的中英文名称', () => {
    expect(formatGripLabel('JUG')).toBe('大把手 · Jug');
    expect(gripEnglishLabel).toMatchObject({
      CRIMP: 'Crimp',
      SLOPER: 'Sloper',
      PINCH: 'Pinch',
      POCKET: 'Pocket',
      FOOTHOLD: 'Foothold',
      VOLUME: 'Volume',
      OTHER: 'Other',
    });
  });

  it('将历史系统说明显示为友好文案', () => {
    expect(formatCategoryDescription('系统预置用途分类')).toBe(defaultCategoryDescription);
    expect(formatCategoryDescription('仅用于儿童区')).toBe('仅用于儿童区');
    expect(formatCategoryDescription(null)).toBe('暂未填写');
  });
});
