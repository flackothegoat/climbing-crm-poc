import { describe, expect, it } from 'vitest';
import { evidenceStateMessage } from './camera-observation-presenter';

describe('录像状态文案', () => {
  it.each([
    ['NOT_RECORDED', '该记录产生时未启用录像留存，因此没有历史录像。'],
    ['PENDING', '录像正在处理或上传，请稍后刷新查看。'],
    ['FAILED', '录像上传未成功，识别结果仍可复核；请联系管理员检查录像服务。'],
    ['EXPIRED', '录像已按安全保留策略自动过期。'],
  ] as const)('将 %s 显示为明确的用户提示', (state, message) => {
    expect(evidenceStateMessage(state)).toBe(message);
  });
});
