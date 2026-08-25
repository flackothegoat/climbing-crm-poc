import { parseWithSchema } from '../common/zod-validation';
import {
  ClimbingColor,
  HoldGripType,
  HoldAssetKind,
  HoldMountingType,
  HoldScanMode,
  HoldSizeClass,
  HoldStatus,
  InventoryBucket,
  InventoryMovementType,
} from '@prisma/client';
import { z } from 'zod';
import { HOLD_LIMITS } from './hold-domain.constants';

const optionalText = (max: number) => z.string().trim().max(max).nullable().optional();
const positiveDimension = z
  .number()
  .int()
  .positive()
  .max(HOLD_LIMITS.maxDimensionMm)
  .nullable()
  .optional();
const categoryCode = z
  .string()
  .trim()
  .toUpperCase()
  .min(1)
  .max(32)
  .regex(/^[A-Z0-9_-]+$/, '编号只能包含字母、数字、横线和下划线');
const createCategorySchema = z.object({
  code: categoryCode,
  name: z.string().trim().min(1).max(80),
  gripType: z.nativeEnum(HoldGripType),
  description: optionalText(500),
});

const updateCategorySchema = createCategorySchema
  .pick({ name: true, description: true })
  .partial()
  .refine((value) => Object.keys(value).length > 0, '至少需要提供一个修改字段');

const specificationSchema = z.object({
  productName: z.string().trim().min(1, '请填写款型或造型名称').max(80),
  manufacturer: z.string().trim().min(1, '请填写生产商；未知时可填写“未知生产商”').max(80),
  style: optionalText(80),
  sizeClass: z.nativeEnum(HoldSizeClass),
  widthMm: positiveDimension,
  heightMm: positiveDimension,
  depthMm: positiveDimension,
  mountingType: z.nativeEnum(HoldMountingType),
  color: z.nativeEnum(ClimbingColor),
  sku: optionalText(64),
});

const updateSpecificationSchema = specificationSchema
  .partial()
  .refine((value) => Object.keys(value).length > 0, '至少需要提供一个修改字段');

const stockMovementSchema = z.discriminatedUnion('type', [
  z.object({
    requestKey: z.string().uuid(),
    type: z.literal(InventoryMovementType.RECEIPT),
    bucket: z.literal(InventoryBucket.WAREHOUSE),
    quantityDelta: z.number().int().min(1).max(HOLD_LIMITS.maxQuantity),
    note: z.string().trim().max(200).nullable().optional(),
  }),
  z.object({
    requestKey: z.string().uuid(),
    type: z.literal(InventoryMovementType.ADJUSTMENT),
    bucket: z.nativeEnum(InventoryBucket),
    targetQuantity: z.number().int().min(0).max(HOLD_LIMITS.maxQuantity),
    expectedVersion: z.number().int().min(0),
    note: z.string().trim().min(1, '库存调整必须填写原因').max(200),
  }),
]);

const reverseMovementSchema = z.object({
  reason: z.string().trim().min(2, '请填写撤销原因').max(200),
});

const permanentlyDeleteSpecificationSchema = z.object({
  expectedVersion: z.number().int().min(0),
  reason: z.string().trim().min(2, '请填写删除原因').max(200),
  confirmationText: z
    .string()
    .trim()
    .refine((value) => value === '删除', '请输入“删除”确认永久删除'),
});

const listCategoriesSchema = z.object({
  search: z.string().trim().max(80).optional(),
  status: z.enum([HoldStatus.ACTIVE, HoldStatus.ARCHIVED, 'ALL']).default(HoldStatus.ACTIVE),
  gripType: z.nativeEnum(HoldGripType).optional(),
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(20),
});

const startInitializationSchema = z.object({
  name: z.string().trim().min(2, '请填写初始化批次名称').max(80),
});

const createScanSchema = z
  .object({
    mode: z.nativeEnum(HoldScanMode).default(HoldScanMode.CREATE_SPECIFICATION),
    categoryId: z.string().cuid().optional(),
    specificationId: z.string().cuid().optional(),
    initializationBatchId: z.string().cuid().optional(),
  })
  .superRefine((input, context) => {
    if (input.mode === HoldScanMode.CREATE_SPECIFICATION && !input.categoryId) {
      context.addIssue({ code: 'custom', message: '新建岩点档案必须选择用途分类' });
    }
    if (input.mode === HoldScanMode.ENRICH_SPECIFICATION && !input.specificationId) {
      context.addIssue({ code: 'custom', message: '补充三维模型必须选择岩点档案' });
    }
  });

const initializationCountFields = {
  warehouseQuantity: z.number().int().min(0).max(HOLD_LIMITS.maxQuantity),
  installedQuantity: z.number().int().min(0).max(HOLD_LIMITS.maxQuantity),
  note: optionalText(200),
};
const hasInitializedInventory = (value: { warehouseQuantity: number; installedQuantity: number }) =>
  value.warehouseQuantity + value.installedQuantity > 0;
const initializationCountsSchema = z
  .object(initializationCountFields)
  .refine(hasInitializedInventory, '仓库与已上墙总数至少为 1');

const finalizeScanSchema = z.object({
  specification: specificationSchema,
  inventory: initializationCountsSchema.optional(),
});

const uploadAssetKindSchema = z
  .nativeEnum(HoldAssetKind)
  .refine(
    (kind) => kind !== HoldAssetKind.MODEL_PREVIEW && kind !== HoldAssetKind.MODEL_3D,
    '展示模型与缩略图必须由原始模型派生',
  );
const previewGenerationVersionSchema = z.coerce.number().int().min(1).max(100);

const initializeSpecificationSchema = z
  .object({ batchId: z.string().cuid(), ...initializationCountFields })
  .refine(hasInitializedInventory, '仓库与已上墙总数至少为 1');

const createHoldRecordSchema = z.object({
  specification: specificationSchema,
  initialization: initializeSpecificationSchema.optional(),
});

export type CreateCategoryInput = z.infer<typeof createCategorySchema>;
export type UpdateCategoryInput = z.infer<typeof updateCategorySchema>;
export type AddSpecificationInput = z.infer<typeof specificationSchema>;
export type UpdateSpecificationInput = z.infer<typeof updateSpecificationSchema>;
export type StockMovementInput = z.infer<typeof stockMovementSchema>;
export type ReverseMovementInput = z.infer<typeof reverseMovementSchema>;
export type PermanentlyDeleteSpecificationInput = z.infer<
  typeof permanentlyDeleteSpecificationSchema
>;
export type ListCategoriesInput = z.infer<typeof listCategoriesSchema>;
export type StartInitializationInput = z.infer<typeof startInitializationSchema>;
export type CreateScanInput = z.infer<typeof createScanSchema>;
export type FinalizeScanInput = z.infer<typeof finalizeScanSchema>;
export type InitializeSpecificationInput = z.infer<typeof initializeSpecificationSchema>;
export type CreateHoldRecordInput = z.infer<typeof createHoldRecordSchema>;

export const parseCreateCategory = (input: unknown) => parse(createCategorySchema, input);
export const parseUpdateCategory = (input: unknown) => parse(updateCategorySchema, input);
export const parseAddSpecification = (input: unknown) => parse(specificationSchema, input);
export const parseUpdateSpecification = (input: unknown) => parse(updateSpecificationSchema, input);
export const parseStockMovement = (input: unknown) => parse(stockMovementSchema, input);
export const parseReverseMovement = (input: unknown) => parse(reverseMovementSchema, input);
export const parsePermanentlyDeleteSpecification = (input: unknown) =>
  parse(permanentlyDeleteSpecificationSchema, input);
export const parseListCategories = (input: unknown) => parse(listCategoriesSchema, input);
export const parseStartInitialization = (input: unknown) => parse(startInitializationSchema, input);
export const parseCreateScan = (input: unknown) => parse(createScanSchema, input);
export const parseFinalizeScan = (input: unknown) => parse(finalizeScanSchema, input);
export const parseInitializeSpecification = (input: unknown) =>
  parse(initializeSpecificationSchema, input);
export const parseCreateHoldRecord = (input: unknown) => parse(createHoldRecordSchema, input);
export const parseAssetKind = (input: unknown) => parse(uploadAssetKindSchema, input);
export const parsePreviewGenerationVersion = (input: unknown) =>
  parse(previewGenerationVersionSchema, input);

const parse = parseWithSchema;
