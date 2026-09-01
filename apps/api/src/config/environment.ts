import { z } from 'zod';

const booleanString = z.enum(['true', 'false']).transform((value) => value === 'true');

const defaultCameraPlayerUrl =
  'https://galsync-climbing-demo-01.southeastasia.cloudapp.azure.com/wvp/#/play/share?type=2&url=wss%3A%2F%2Fgalsync-climbing-demo-01.southeastasia.cloudapp.azure.com%2Fwvp-media%2Frtp%2F34020000001320000001_34020000001320000001.live.flv%3ForiginTypeStr%3Drtp_push%26videoCodec%3DH264';
const defaultCameraResourceUrl =
  'wss://galsync-climbing-demo-01.southeastasia.cloudapp.azure.com/wvp-media/rtp/34020000001320000001_34020000001320000001.live.flv?originTypeStr=rtp_push&videoCodec=H264';
const defaultCameraProbeUrl =
  'https://galsync-climbing-demo-01.southeastasia.cloudapp.azure.com/wvp-media/rtp/34020000001320000001_34020000001320000001.live.flv?originTypeStr=rtp_push&videoCodec=H264';

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
    CAMERA_LIVE_ENABLED: booleanString.default(true),
    CAMERA_LIVE_NAME: z.string().trim().min(1).max(80).default('攀岩墙主摄像头'),
    CAMERA_PLAYER_URL: z.string().url().default(defaultCameraPlayerUrl),
    CAMERA_RESOURCE_URL: z.string().url().default(defaultCameraResourceUrl),
    CAMERA_PROBE_URL: z.string().url().default(defaultCameraProbeUrl),
    CAMERA_PROBE_TIMEOUT_MS: z.coerce.number().int().min(500).max(15000).default(4000),
    CAMERA_PROBE_CACHE_MS: z.coerce.number().int().min(0).max(60000).default(10000),
    CAMERA_SNAPSHOT_TIMEOUT_MS: z.coerce.number().int().min(5000).max(60000).default(20000),
    CAMERA_SNAPSHOT_CACHE_MS: z.coerce.number().int().min(0).max(60000).default(5000),
    CAMERA_SNAPSHOT_STALE_MS: z.coerce
      .number()
      .int()
      .min(0)
      .max(30 * 60 * 1000)
      .default(5 * 60 * 1000),
    CAMERA_WORKER_TOKEN: z.string().min(32).optional(),
    CAMERA_WORKER_ORGANIZATION_ID: z.string().trim().min(1).max(128).optional(),
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
