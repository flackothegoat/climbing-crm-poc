import { z } from 'zod';
import { parseWithSchema } from '../common/zod-validation';

const cameraWorkerHeartbeatSchema = z.object({
  status: z.enum(['ONLINE', 'OFFLINE']),
  detail: z.string().trim().min(1).max(200),
  recognitionState: z.enum(['ACTIVE', 'WAITING_REFERENCE', 'PAUSED_IMAGE_QUALITY']).optional(),
  activeAttempt: z.string().trim().min(1).max(120).nullable().optional(),
  routeDefinitionCount: z.number().int().min(0).max(1000),
  checkedAt: z.string().datetime({ offset: true }),
});

export type CameraWorkerHeartbeat = z.infer<typeof cameraWorkerHeartbeatSchema>;

export const parseCameraWorkerHeartbeat = (input: unknown) =>
  parseWithSchema(cameraWorkerHeartbeatSchema, input);
