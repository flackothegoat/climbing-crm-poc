import type { HoldGripType } from './hold-api';

export const gripOptions = [
  ['JUG', '大把手'],
  ['CRIMP', '小扣点'],
  ['SLOPER', '斜面'],
  ['PINCH', '捏点'],
  ['POCKET', '指洞'],
  ['FOOTHOLD', '脚点'],
  ['VOLUME', '大型岩体'],
  ['OTHER', '其他'],
] as const;

export const sizeOptions = ['XS', 'S', 'M', 'L', 'XL', 'XXL'] as const;

export const mountingOptions = [
  ['BOLT_ON', '主螺栓固定'],
  ['SCREW_ON', '木螺丝固定'],
  ['DUAL', '混合固定'],
  ['UNKNOWN', '待确认'],
] as const;

export const gripLabel = Object.fromEntries(gripOptions) as Record<HoldGripType, string>;
export const gripEnglishLabel: Record<HoldGripType, string> = {
  JUG: 'Jug',
  CRIMP: 'Crimp',
  SLOPER: 'Sloper',
  PINCH: 'Pinch',
  POCKET: 'Pocket',
  FOOTHOLD: 'Foothold',
  VOLUME: 'Volume',
  OTHER: 'Other',
};
const legacyDefaultCategoryDescription = '系统预置用途分类';
export const defaultCategoryDescription = '默认分类';
export const mountingLabel = Object.fromEntries(mountingOptions) as Record<string, string>;

export function formatGripLabel(gripType: HoldGripType): string {
  return `${gripLabel[gripType]} · ${gripEnglishLabel[gripType]}`;
}

export function formatCategoryDescription(description: string | null): string {
  if (description === legacyDefaultCategoryDescription) return defaultCategoryDescription;
  return description ?? '暂未填写';
}

export const bucketLabel: Record<string, string> = {
  WAREHOUSE: '仓库',
  INSTALLED: '已上墙',
  RESERVED: '换线预留',
  MAINTENANCE: '维护中',
};

export const movementLabel: Record<string, string> = {
  INITIAL_BALANCE: '初始建档',
  RECEIPT: '正常入库',
  ADJUSTMENT: '库存调整',
  REVERSAL: '撤销入库',
};
