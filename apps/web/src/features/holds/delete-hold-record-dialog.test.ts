import { describe, expect, it } from 'vitest';
import { canConfirmPermanentDeletion } from './delete-hold-record-dialog';

describe('岩点档案永久删除确认', () => {
  it('只有原因完整且精确输入“删除”时才允许提交', () => {
    expect(canConfirmPermanentDeletion('重复建档', '删除')).toBe(true);
    expect(canConfirmPermanentDeletion('重', '删除')).toBe(false);
    expect(canConfirmPermanentDeletion('重复建档', '确认')).toBe(false);
  });
});
