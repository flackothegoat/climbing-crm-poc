import { HoldInstallationSource, InventoryBucket, PlacementAnchorRole } from '@prisma/client';
import { z } from 'zod';
import { parseWithSchema } from '../common/zod-validation';

const id = z.string().trim().min(1).max(128);
const dateTime = z.string().datetime({ offset: true });

const anchorSchema = z.object({
  wallHoleId: id,
  role: z.nativeEnum(PlacementAnchorRole),
});

const installSchema = z
  .object({
    requestKey: z.string().uuid(),
    routeHoldPlacementId: id.optional(),
    holdVariantId: id.optional(),
    settingJobId: id.optional(),
    source: z.nativeEnum(HoldInstallationSource),
    installedAt: dateTime.optional(),
    note: z.string().trim().max(500).optional(),
    anchors: z.array(anchorSchema).min(1).max(16).optional(),
  })
  .superRefine((input, context) => {
    if (!input.routeHoldPlacementId && (!input.holdVariantId || !input.anchors)) {
      context.addIssue({ code: 'custom', message: '人工安装必须提供岩点档案和安装孔位' });
    }
    if (input.routeHoldPlacementId && (input.holdVariantId || input.anchors)) {
      context.addIssue({ code: 'custom', message: '按线路位置安装时不得重复提交岩点或孔位' });
    }
    if (input.anchors) {
      if (
        input.anchors.filter((anchor) => anchor.role === PlacementAnchorRole.PRIMARY).length !== 1
      ) {
        context.addIssue({ code: 'custom', message: '安装孔位必须且只能包含一个主孔' });
      }
      if (new Set(input.anchors.map((anchor) => anchor.wallHoleId)).size !== input.anchors.length) {
        context.addIssue({ code: 'custom', message: '安装孔位不能重复' });
      }
    }
  });

const removeSchema = z.object({
  requestKey: z.string().uuid(),
  targetBucket: z.enum([InventoryBucket.WAREHOUSE, InventoryBucket.MAINTENANCE]),
  removedAt: dateTime.optional(),
  note: z.string().trim().max(500).optional(),
});

export type InstallHoldInput = z.infer<typeof installSchema>;
export type RemoveHoldInput = z.infer<typeof removeSchema>;

export const parseInstallHold = (input: unknown) => parseWithSchema(installSchema, input);
export const parseRemoveHold = (input: unknown) => parseWithSchema(removeSchema, input);
