import { z } from 'zod';

const booleanString = z.enum(['true', 'false']).transform((value) => value === 'true');

const environmentSchema = z
  .object({
    NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
    API_PORT: z.coerce.number().int().min(1).max(65535).default(3101),
    DATABASE_URL: z.string().url(),
    SESSION_COOKIE_NAME: z.string().min(1).default('climbing_crm_session'),
    SESSION_COOKIE_SECURE: booleanString.default(false),
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
    MINIO_USE_SSL: booleanString.default(false),
    MINIO_ACCESS_KEY: z.string().min(1),
    MINIO_SECRET_KEY: z.string().min(8),
    PUBLIC_LINK_SIGNING_KEY: z.string().min(32).optional(),
    MINIO_BUCKET: z.string().min(3).default('climbingapp-hold-assets'),
    SWAGGER_ENABLED: booleanString.optional(),
    OBJECT_STORAGE_REQUIRED: booleanString.default(false),
    REQUEST_LOG_ENABLED: booleanString.default(true),
  })
  .superRefine((environment, context) => {
    if (environment.NODE_ENV === 'production' && !environment.SESSION_COOKIE_SECURE) {
      context.addIssue({
        code: 'custom',
        path: ['SESSION_COOKIE_SECURE'],
        message: '生产环境必须启用安全 Cookie',
      });
    }
  })
  .transform((environment) => ({
    ...environment,
    PUBLIC_LINK_SIGNING_KEY: environment.PUBLIC_LINK_SIGNING_KEY ?? environment.MINIO_SECRET_KEY,
    SWAGGER_ENABLED: environment.SWAGGER_ENABLED ?? environment.NODE_ENV !== 'production',
  }));

export type AppEnvironment = z.infer<typeof environmentSchema>;

export function readEnvironment(source: NodeJS.ProcessEnv = process.env): AppEnvironment {
  return environmentSchema.parse({
    ...source,
    MINIO_PORT: source.MINIO_PORT ?? source.POC_MINIO_API_PORT,
    MINIO_ACCESS_KEY: source.MINIO_ACCESS_KEY ?? source.MINIO_ROOT_USER,
    MINIO_SECRET_KEY: source.MINIO_SECRET_KEY ?? source.MINIO_ROOT_PASSWORD,
  });
}
