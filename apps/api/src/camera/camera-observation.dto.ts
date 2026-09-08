import { CameraObservationReviewDecision, ClimbObservationOutcome } from '@prisma/client';
import { z } from 'zod';
import { databaseIdSchema } from '../common/database-id';
import { parseWithSchema } from '../common/zod-validation';

const failureReason = z.enum([
  'OFF_ROUTE_CONTACT',
  'FALL_BEFORE_FINISH',
  'FINISH_NOT_CONFIRMED',
  'INVALID_OR_UNCONFIRMED_START',
  'TRACKING_LOST',
]);

const analysisEvent = z.object({
  type: z.string().trim().min(1).max(64),
  timestampS: z.number().finite().min(0),
  confidence: z.number().finite().min(0).max(1),
  evidence: z.string().trim().min(1).max(300),
  limb: z.string().trim().min(1).max(32).optional(),
});

const createCameraObservationSchema = z.object({
  requestKey: z.string().uuid(),
  routeId: databaseIdSchema,
  routeVersionId: databaseIdSchema,
  wallSegmentId: databaseIdSchema.optional(),
  observedAt: z.string().datetime({ offset: true }),
  climberKey: z.string().trim().min(1).max(128).optional(),
  analysis: z.object({
    schemaVersion: z.number().int().min(1).max(10),
    attemptId: z.string().trim().min(1).max(128),
    modelVersion: z.string().trim().min(1).max(128),
    calibrationId: z.string().trim().min(1).max(128),
    outcome: z.nativeEnum(ClimbObservationOutcome),
    failureReasons: z.array(failureReason).max(8).default([]),
    confidence: z.number().finite().min(0).max(1),
    requiresReview: z.boolean(),
    startedAtS: z.number().finite().min(0).nullable(),
    finishReachedAtS: z.number().finite().min(0).nullable(),
    fallAtS: z.number().finite().min(0).nullable(),
    events: z.array(analysisEvent).max(128),
  }),
});

const listCameraObservationsSchema = z.object({
  pageSize: z.coerce.number().int().min(1).max(50).default(20),
  cursor: databaseIdSchema.optional(),
  query: z.string().trim().max(100).optional(),
  routeId: databaseIdSchema.optional(),
  outcome: z.nativeEnum(ClimbObservationOutcome).optional(),
  reviewStatus: z
    .enum(['PENDING', 'UNREVIEWED', 'CONFIRMED', 'OVERRIDDEN', 'INVALIDATED'])
    .optional(),
  observedFrom: z.string().datetime({ offset: true }).optional(),
  observedTo: z.string().datetime({ offset: true }).optional(),
});

const reviewCameraObservationSchema = z
  .object({
    decision: z.nativeEnum(CameraObservationReviewDecision),
    comment: z.string().trim().max(500).optional(),
  })
  .superRefine((value, context) => {
    if (value.decision !== CameraObservationReviewDecision.CONFIRM && !value.comment) {
      context.addIssue({
        code: 'custom',
        path: ['comment'],
        message: '改判或标记无效时请填写原因',
      });
    }
  });

const cameraObservationEvidenceSchema = z.object({
  durationMs: z.coerce
    .number()
    .int()
    .min(1)
    .max((10 * 60 + 30) * 1_000),
  sizeBytes: z.coerce
    .number()
    .int()
    .min(1)
    .max(128 * 1024 * 1024),
  checksumSha256: z
    .string()
    .trim()
    .regex(/^[a-f0-9]{64}$/i, '录像校验值格式不正确'),
});

export type CreateCameraObservationInput = z.infer<typeof createCameraObservationSchema>;
export type ListCameraObservationsInput = z.infer<typeof listCameraObservationsSchema>;
export type ReviewCameraObservationInput = z.infer<typeof reviewCameraObservationSchema>;
export type CameraObservationEvidenceInput = z.infer<typeof cameraObservationEvidenceSchema>;

export const parseCameraObservation = (input: unknown) =>
  parseWithSchema(createCameraObservationSchema, input);
export const parseListCameraObservations = (input: unknown) =>
  parseWithSchema(listCameraObservationsSchema, input);
export const parseReviewCameraObservation = (input: unknown) =>
  parseWithSchema(reviewCameraObservationSchema, input);
export const parseCameraObservationEvidence = (input: unknown) =>
  parseWithSchema(cameraObservationEvidenceSchema, input);
export const parseCameraObservationId = (input: unknown) =>
  parseWithSchema(databaseIdSchema, input);
