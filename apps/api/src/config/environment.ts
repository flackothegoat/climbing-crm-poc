import { z } from 'zod';

const environmentSchema = z.object({
  API_PORT: z.coerce.number().int().min(1).max(65535).default(3101),
  DATABASE_URL: z.string().url(),
  SESSION_COOKIE_NAME: z.string().min(1).default('climbing_crm_session'),
  SESSION_COOKIE_SECURE: z
    .enum(['true', 'false'])
    .transform((value) => value === 'true')
    .default(false),
  SESSION_TTL_HOURS: z.coerce
    .number()
    .int()
    .min(1)
    .max(24 * 30)
    .default(168),
  INVITATION_TTL_HOURS: z.coerce
    .number()
    .int()
    .min(1)
    .max(24 * 14)
    .default(72),
  WEB_ORIGIN: z.string().url().default('http://localhost:3100'),
  MINIO_ENDPOINT: z.string().min(1).default('localhost'),
  MINIO_PORT: z.coerce.number().int().min(1).max(65535).default(9002),
  MINIO_USE_SSL: z
    .enum(['true', 'false'])
    .transform((value) => value === 'true')
    .default(false),
  MINIO_ACCESS_KEY: z.string().min(1),
  MINIO_SECRET_KEY: z.string().min(8),
  MINIO_BUCKET: z.string().min(3).default('climbingapp-hold-assets'),
});

export type AppEnvironment = z.infer<typeof environmentSchema>;

export function readEnvironment(source: NodeJS.ProcessEnv = process.env): AppEnvironment {
  return environmentSchema.parse({
    ...source,
    MINIO_PORT: source.MINIO_PORT ?? source.POC_MINIO_API_PORT,
    MINIO_ACCESS_KEY: source.MINIO_ACCESS_KEY ?? source.MINIO_ROOT_USER,
    MINIO_SECRET_KEY: source.MINIO_SECRET_KEY ?? source.MINIO_ROOT_PASSWORD,
  });
}
