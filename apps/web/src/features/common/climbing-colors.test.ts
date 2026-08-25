import { describe, expect, it } from 'vitest';
import { climbingColorCss, climbingColorLabel, climbingColorOptions } from './climbing-colors';

describe('统一攀岩颜色', () => {
  it('每个业务枚举都有唯一中文名称和固定展示色', () => {
    expect(new Set(climbingColorOptions.map((item) => item.value)).size).toBe(
      climbingColorOptions.length,
    );
    expect(new Set(climbingColorOptions.map((item) => item.label)).size).toBe(
      climbingColorOptions.length,
    );
    for (const option of climbingColorOptions) {
      expect(climbingColorLabel(option.value)).toBe(option.label);
      expect(climbingColorCss(option.value)).toMatch(/^#[0-9A-F]{6}$/);
    }
  });
});
