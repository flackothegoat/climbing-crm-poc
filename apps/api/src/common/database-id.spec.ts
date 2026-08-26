import { describe, expect, it } from 'vitest';
import { databaseIdSchema } from './database-id';

describe('databaseIdSchema', () => {
  it.each([
    'cmsn01ew200hlv8i4cz0jji38',
    '918a3b0c-026d-43c8-8155-13bea290c23b',
    'facility_default_918a3b0c-026d-43c8-8155-13bea290c23b',
  ])('接受现存数据库 ID：%s', (value) => {
    expect(databaseIdSchema.parse(value)).toBe(value);
  });

  it.each(['', 'facility/default', 'facility default', '../facility'])(
    '拒绝非法 ID：%s',
    (value) => {
      expect(() => databaseIdSchema.parse(value)).toThrow();
    },
  );
});
