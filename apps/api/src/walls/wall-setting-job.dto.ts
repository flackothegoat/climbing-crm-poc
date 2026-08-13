import { z } from 'zod';
import { parseWithSchema } from '../common/zod-validation';

const id = z.string().trim().min(1).max(128);
const wallCode = id.transform((value) => value.toUpperCase());

const createJobSchema = z.object({ wallCode });
const jobActionSchema = z.object({
  requestKey: z.string().uuid(),
  installedAt: z.string().datetime({ offset: true }).optional(),
});
const listAssetsSchema = z.object({
  cursor: id.optional(),
  limit: z.coerce.number().int().min(1).max(200).default(100),
});

export type CreateWallSettingJobInput = z.infer<typeof createJobSchema>;
export type WallSettingJobActionInput = z.infer<typeof jobActionSchema>;
export type ListRouteSettingAssetsInput = z.infer<typeof listAssetsSchema>;

export const parseCreateWallSettingJob = (input: unknown) =>
  parseWithSchema(createJobSchema, input);
export const parseWallSettingJobAction = (input: unknown) =>
  parseWithSchema(jobActionSchema, input);
export const parseListRouteSettingAssets = (input: unknown) =>
  parseWithSchema(listAssetsSchema, input);
export const parseOptionalSettingJobId = (input: unknown): string | undefined =>
  input === undefined ? undefined : parseWithSchema(id, input);
