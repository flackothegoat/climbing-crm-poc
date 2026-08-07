import { describe, expect, it } from 'vitest';
import { parseLoginInput, parseRegisterInput } from './auth.dto';

describe('auth input validation', () => {
  it('normalizes a registration email and workspace name', () => {
    expect(
      parseRegisterInput({
        email: ' OWNER@EXAMPLE.COM ',
        password: 'secure-password',
        organizationName: ' Peak ',
      }),
    ).toEqual({
      email: 'owner@example.com',
      password: 'secure-password',
      organizationName: 'Peak',
    });
  });

  it('rejects a short registration password', () => {
    expect(() =>
      parseRegisterInput({
        email: 'owner@example.com',
        password: 'short',
        organizationName: 'Peak',
      }),
    ).toThrow('密码至少需要 12 位');
  });

  it('accepts the existing login password rule', () => {
    expect(parseLoginInput({ email: 'owner@example.com', password: 'x' })).toEqual({
      email: 'owner@example.com',
      password: 'x',
    });
  });
});
