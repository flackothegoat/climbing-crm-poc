import { BadRequestException } from '@nestjs/common';
import { ClimbObservationOutcome, RoutePlacementRole } from '@prisma/client';
import { z } from 'zod';

const code = z
  .string()
  .trim()
  .min(1)
  .max(64)
  .regex(/^[A-Za-z0-9_-]+$/, '编号只能包含字母、数字、横线和下划线');
const wallCode = code.transform((value) => value.toUpperCase());
const isoDateTime = z.string().datetime({ offset: true });

const routeSchema = z.object({
  id: code,
  name: z.string().trim().min(1).max(80),
  color: z.string().trim().min(1).max(32),
  grade: z.string().trim().min(1).max(32),
});

const placementSchema = z.object({
  id: z.string().trim().min(1).max(128),
  assetId: z.string().trim().min(1).max(128),
  routeId: code,
  holeId: code,
  role: z.nativeEnum(RoutePlacementRole),
  rotationDegrees: z.number().int().min(-359).max(359),
});

const saveRouteSettingPlanSchema = z
  .object({
    schemaVersion: z.literal(1),
    wall: z.object({ code: wallCode }).passthrough(),
    routes: z.array(routeSchema).min(1).max(64),
    placements: z.array(placementSchema).max(2_000),
    updatedAt: isoDateTime,
  })
  .superRefine((plan, context) => {
    const routeIds = new Set(plan.routes.map((route) => route.id));
    const placementIds = new Set<string>();
    for (const placement of plan.placements) {
      if (!routeIds.has(placement.routeId)) {
        context.addIssue({ code: 'custom', message: '岩点位置引用了不存在的线路' });
      }
      if (placementIds.has(placement.id)) {
        context.addIssue({ code: 'custom', message: '岩点位置编号不能重复' });
      }
      placementIds.add(placement.id);
    }
  });

const listObservationsSchema = z
  .object({
    wallCode,
    routeId: code.optional(),
    from: isoDateTime.optional(),
    to: isoDateTime.optional(),
  })
  .refine((value) => !value.from || !value.to || value.from < value.to, '开始时间必须早于结束时间');

const createObservationSchema = z.object({
  wallCode,
  routeId: code,
  outcome: z.nativeEnum(ClimbObservationOutcome),
  observedAt: isoDateTime,
  climberKey: z.string().trim().min(1).max(128).optional(),
  requestKey: z.string().uuid(),
});

export type SaveRouteSettingPlanInput = z.infer<typeof saveRouteSettingPlanSchema>;
export type ListObservationsInput = z.infer<typeof listObservationsSchema>;
export type CreateObservationInput = z.infer<typeof createObservationSchema>;

export const parseWallCode = (input: unknown) => parse(wallCode, input);
export const parseSaveRouteSettingPlan = (input: unknown) =>
  parse(saveRouteSettingPlanSchema, input);
export const parseListObservations = (input: unknown) => parse(listObservationsSchema, input);
export const parseCreateObservation = (input: unknown) => parse(createObservationSchema, input);

function parse<T>(schema: z.ZodType<T>, input: unknown): T {
  const result = schema.safeParse(input);
  if (result.success) return result.data;
  throw new BadRequestException(result.error.issues[0]?.message ?? '请求参数不符合要求');
}
