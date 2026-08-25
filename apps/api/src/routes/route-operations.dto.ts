import {
  ClimbingColor,
  RouteDifficultyVote,
  RouteEnjoymentVote,
  RouteFeedbackOutcome,
  RoutePlacementRole,
  RouteStatus,
} from '@prisma/client';
import { z } from 'zod';
import { parseWithSchema } from '../common/zod-validation';

const code = z
  .string()
  .trim()
  .min(1)
  .max(64)
  .regex(/^[A-Za-z0-9_-]+$/, '编号只能包含字母、数字、横线和下划线')
  .transform((value) => value.toUpperCase());
const id = z.string().trim().min(10).max(128);
const optionalDateTime = z.string().datetime({ offset: true }).nullish();
const styleTags = z
  .array(z.string().trim().min(1).max(24))
  .max(8)
  .default([])
  .transform((values) => [...new Set(values)]);

const routeFields = {
  code,
  name: z.string().trim().min(1).max(80),
  description: z.string().trim().max(500).nullish(),
  color: z.nativeEnum(ClimbingColor),
  grade: z.string().trim().min(1).max(32),
  gradeSystem: z.string().trim().min(1).max(32),
  styleTags,
  setterMembershipId: id.nullish(),
  wallSegmentIds: z
    .array(id)
    .min(1)
    .max(8)
    .transform((values) => [...new Set(values)]),
  expectedRetireAt: optionalDateTime,
};

const createRouteSchema = z.object(routeFields);
const updateRouteSchema = z
  .object(routeFields)
  .partial()
  .refine((value) => Object.keys(value).length > 0, {
    message: '至少需要修改一个字段',
  });

const listRoutesSchema = z.object({
  status: z.nativeEnum(RouteStatus).optional(),
  wallSegmentId: id.optional(),
});

const createWallSchema = z.object({
  areaCode: code,
  areaName: z.string().trim().min(1).max(80),
  floorLabel: z.string().trim().max(40).nullish(),
  segmentCode: code,
  segmentName: z.string().trim().min(1).max(80),
});

const publicTokenSchema = z.string().trim().min(20).max(160);

const submitFeedbackSchema = z.object({
  outcome: z.nativeEnum(RouteFeedbackOutcome),
  difficulty: z.nativeEnum(RouteDifficultyVote),
  enjoyment: z.nativeEnum(RouteEnjoymentVote),
  safetyConcern: z.boolean().default(false),
  comment: z.string().trim().max(300).nullish(),
  anonymousSessionId: z.string().trim().min(16).max(128),
  requestKey: z.string().uuid(),
});

const analyticsQuerySchema = z
  .object({
    from: z.string().datetime({ offset: true }).optional(),
    to: z.string().datetime({ offset: true }).optional(),
    wallSegmentId: id.optional(),
  })
  .refine((value) => !value.from || !value.to || value.from < value.to, '开始时间必须早于结束时间');

const visualPointSchema = z.object({
  wallSegmentId: id,
  role: z.nativeEnum(RoutePlacementRole),
  uNormalized: z.number().finite().min(0).max(1),
  vNormalized: z.number().finite().min(0).max(1),
});

const saveVisualAnnotationSchema = z
  .object({ points: z.array(visualPointSchema).min(2).max(64) })
  .superRefine(({ points }, context) => {
    if (points[0]?.role !== RoutePlacementRole.START) {
      context.addIssue({
        code: 'custom',
        path: ['points', 0, 'role'],
        message: '第一个点必须是起点',
      });
    }
    if (points.at(-1)?.role !== RoutePlacementRole.FINISH) {
      context.addIssue({
        code: 'custom',
        path: ['points', points.length - 1, 'role'],
        message: '最后一个点必须是终点',
      });
    }
    if (points.slice(1, -1).some((point) => point.role !== RoutePlacementRole.NORMAL)) {
      context.addIssue({ code: 'custom', path: ['points'], message: '中间点必须是普通岩点' });
    }
  });

export type CreateRouteInput = z.infer<typeof createRouteSchema>;
export type UpdateRouteInput = z.infer<typeof updateRouteSchema>;
export type ListRoutesInput = z.infer<typeof listRoutesSchema>;
export type CreateWallInput = z.infer<typeof createWallSchema>;
export type SubmitFeedbackInput = z.infer<typeof submitFeedbackSchema>;
export type AnalyticsQueryInput = z.infer<typeof analyticsQuerySchema>;
export type SaveVisualAnnotationInput = z.infer<typeof saveVisualAnnotationSchema>;

const parse = parseWithSchema;
export const parseCreateRoute = (input: unknown) => parse(createRouteSchema, input);
export const parseUpdateRoute = (input: unknown) => parse(updateRouteSchema, input);
export const parseListRoutes = (input: unknown) => parse(listRoutesSchema, input);
export const parseCreateWall = (input: unknown) => parse(createWallSchema, input);
export const parseRouteId = (input: unknown) => parse(id, input);
export const parsePublicRouteToken = (input: unknown) => parse(publicTokenSchema, input);
export const parseSubmitFeedback = (input: unknown) => parse(submitFeedbackSchema, input);
export const parseAnalyticsQuery = (input: unknown) => parse(analyticsQuerySchema, input);
export const parseSaveVisualAnnotation = (input: unknown) =>
  parse(saveVisualAnnotationSchema, input);
