import { z } from 'zod';
import { databaseIdSchema } from '../common/database-id';
import { parseWithSchema } from '../common/zod-validation';

const normalized = z.number().finite().min(0).max(1);
const holdId = z.string().trim().min(1).max(80);
const pointSchema = z.object({ x: normalized, y: normalized });

const roiSchema = z
  .object({ x1: normalized, y1: normalized, x2: normalized, y2: normalized })
  .superRefine((roi, context) => {
    if (roi.x2 - roi.x1 < 0.05) {
      context.addIssue({ code: 'custom', path: ['x2'], message: '识别区域宽度过小' });
    }
    if (roi.y2 - roi.y1 < 0.05) {
      context.addIssue({ code: 'custom', path: ['y2'], message: '识别区域高度过小' });
    }
  });

const holdSchema = z.object({
  id: holdId,
  x: normalized,
  y: normalized,
  width: z.number().finite().min(0.002).max(0.35),
  height: z.number().finite().min(0.002).max(0.35),
  polygon: z.array(pointSchema).min(3).max(192).optional(),
  holes: z.array(z.array(pointSchema).min(3).max(192)).max(12).optional(),
  colorHex: z
    .string()
    .trim()
    .regex(/^#[0-9A-Fa-f]{6}$/),
  colorCluster: z.string().trim().min(1).max(40),
  confidence: z.number().finite().min(0).max(1).optional(),
  source: z.enum(['AUTO_COLOR', 'PROMPT_SEGMENTATION', 'MANUAL']).optional(),
  modelVersion: z.string().trim().min(1).max(80).optional(),
});

const saveCameraRouteDefinitionSchema = z
  .object({
    routeId: databaseIdSchema,
    routeVersionId: databaseIdSchema,
    wallSegmentId: databaseIdSchema,
    referenceWidth: z.number().int().min(320).max(7680),
    referenceHeight: z.number().int().min(180).max(4320),
    roi: roiSchema,
    holds: z.array(holdSchema).min(2).max(512),
    startHoldIds: z.array(holdId).min(1).max(4),
    finishHoldIds: z.array(holdId).min(1).max(4),
  })
  .superRefine((input, context) => {
    const ids = new Set(input.holds.map((hold) => hold.id));
    if (ids.size !== input.holds.length) {
      context.addIssue({ code: 'custom', path: ['holds'], message: '岩点 ID 不能重复' });
    }
    for (const [field, values] of [
      ['startHoldIds', input.startHoldIds],
      ['finishHoldIds', input.finishHoldIds],
    ] as const) {
      if (values.some((id) => !ids.has(id))) {
        context.addIssue({ code: 'custom', path: [field], message: '起终点必须属于线路岩点' });
      }
      if (new Set(values).size !== values.length) {
        context.addIssue({ code: 'custom', path: [field], message: '起终点岩点不能重复' });
      }
    }
    if (input.startHoldIds.some((id) => input.finishHoldIds.includes(id))) {
      context.addIssue({
        code: 'custom',
        path: ['finishHoldIds'],
        message: '起点和终点不能是同一岩点',
      });
    }
  });

export type SaveCameraRouteDefinitionInput = z.infer<typeof saveCameraRouteDefinitionSchema>;
export type CameraRouteHoldInput = SaveCameraRouteDefinitionInput['holds'][number];

export const parseSaveCameraRouteDefinition = (input: unknown) =>
  parseWithSchema(saveCameraRouteDefinitionSchema, input);
