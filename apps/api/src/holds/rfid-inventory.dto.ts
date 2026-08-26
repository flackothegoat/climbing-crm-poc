import { HoldUnitPhysicalStatus, RfidInventorySessionStatus } from '@prisma/client';
import { z } from 'zod';
import { parseWithSchema } from '../common/zod-validation';
import { rfidIdentifierSchema } from './hold-rfid';

const listRfidInventorySessionsSchema = z.object({
  status: z.nativeEnum(RfidInventorySessionStatus).optional(),
  pageSize: z.coerce.number().int().min(1).max(50).default(20),
});

const createRfidInventorySessionSchema = z.object({
  requestKey: z.string().uuid(),
  name: z.string().trim().min(2, '请填写盘点名称').max(80),
  facilityId: z.string().cuid().optional(),
  targetPhysicalStatus: z.enum([
    HoldUnitPhysicalStatus.WAREHOUSE,
    HoldUnitPhysicalStatus.INSTALLED,
  ]),
});

const ingestRfidInventoryReadsSchema = z.object({
  requestKey: z.string().uuid(),
  epcs: z.array(rfidIdentifierSchema).min(1, '请上报至少一个 EPC').max(500),
});

const transitionRfidInventorySessionSchema = z.object({
  expectedVersion: z.number().int().min(0),
});

export type ListRfidInventorySessionsInput = z.infer<typeof listRfidInventorySessionsSchema>;
export type CreateRfidInventorySessionInput = z.infer<typeof createRfidInventorySessionSchema>;
export type IngestRfidInventoryReadsInput = z.infer<typeof ingestRfidInventoryReadsSchema>;
export type TransitionRfidInventorySessionInput = z.infer<
  typeof transitionRfidInventorySessionSchema
>;

export const parseListRfidInventorySessions = (input: unknown) =>
  parseWithSchema(listRfidInventorySessionsSchema, input);
export const parseCreateRfidInventorySession = (input: unknown) =>
  parseWithSchema(createRfidInventorySessionSchema, input);
export const parseIngestRfidInventoryReads = (input: unknown) =>
  parseWithSchema(ingestRfidInventoryReadsSchema, input);
export const parseTransitionRfidInventorySession = (input: unknown) =>
  parseWithSchema(transitionRfidInventorySessionSchema, input);
