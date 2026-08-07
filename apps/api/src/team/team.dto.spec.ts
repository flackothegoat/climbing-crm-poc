import { describe, expect, it } from 'vitest';
import { parseAcceptInvitation, parseCreateInvitation, parseUpdateMember } from './team.dto';

describe('team input validation', () => {
  it('标准化邀请邮箱', () => {
    expect(parseCreateInvitation({ email: ' STAFF@EXAMPLE.COM ' })).toEqual({
      email: 'staff@example.com',
    });
  });

  it('拒绝空的员工修改', () => {
    expect(() => parseUpdateMember({})).toThrow('至少需要提供一个修改字段');
  });

  it('接受有效的员工邀请资料', () => {
    expect(
      parseAcceptInvitation({ displayName: ' 路线小王 ', password: 'secure-password' }),
    ).toEqual({ displayName: '路线小王', password: 'secure-password' });
  });
});
