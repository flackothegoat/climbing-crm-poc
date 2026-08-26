import { z } from 'zod';

/**
 * Database identifiers are opaque to API clients. Most new rows use CUIDs,
 * while migrated rows may use UUIDs or stable prefixed identifiers.
 */
export const databaseIdSchema = z
  .string()
  .trim()
  .min(1, '资源 ID 不能为空')
  .max(128, '资源 ID 过长')
  .regex(/^[A-Za-z0-9_-]+$/, '资源 ID 格式不正确');
