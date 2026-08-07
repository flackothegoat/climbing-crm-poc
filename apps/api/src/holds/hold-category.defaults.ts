import { HoldCategorySource, HoldGripType } from '@prisma/client';

const categoryNames: Record<HoldGripType, string> = {
  JUG: '大把手',
  CRIMP: '小扣点',
  SLOPER: '斜面',
  PINCH: '捏点',
  POCKET: '指洞',
  FOOTHOLD: '脚点',
  VOLUME: '大型岩体',
  OTHER: '其他',
};

export function defaultCategoryData(organizationId: string, createdByAccountId: string) {
  return Object.values(HoldGripType).map((gripType) => ({
    organizationId,
    createdByAccountId,
    gripType,
    code: `SYSTEM-${gripType}`,
    name: categoryNames[gripType],
    description: '默认分类',
    source: HoldCategorySource.DEFAULT,
  }));
}
