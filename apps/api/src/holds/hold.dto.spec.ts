import { BadRequestException } from '@nestjs/common';
import { HoldGripType, HoldMountingType, HoldScanMode, HoldSizeClass } from '@prisma/client';
import { describe, expect, it } from 'vitest';
import {
  parseAddSpecification,
  parseCreateCategory,
  parseCreateScan,
  parseInitializeSpecification,
  parsePermanentlyDeleteSpecification,
  parseReverseMovement,
  parseStockMovement,
} from './hold.dto';

describe('岩点参数校验', () => {
  it('永久删除必须携带库存版本、原因并输入删除确认', () => {
    expect(
      parsePermanentlyDeleteSpecification({
        expectedVersion: 3,
        reason: '现场重复建档',
        confirmationText: '删除',
      }),
    ).toEqual({ expectedVersion: 3, reason: '现场重复建档', confirmationText: '删除' });
    expect(() =>
      parsePermanentlyDeleteSpecification({
        expectedVersion: 3,
        reason: '现场重复建档',
        confirmationText: '确认',
      }),
    ).toThrow('请输入“删除”确认永久删除');
  });

  it('统一规范化用途分类编号', () => {
    const result = parseCreateCategory({
      code: ' 002 ',
      name: '小扣点',
      gripType: HoldGripType.CRIMP,
    });
    expect(result.code).toBe('002');
  });

  it('规格必须包含可用于批量入库的完整属性', () => {
    const result = parseAddSpecification({
      productName: '波浪小扣点',
      manufacturer: 'Example Holds',
      sizeClass: HoldSizeClass.S,
      mountingType: HoldMountingType.BOLT_ON,
      colorName: '黄色',
      colorHex: '#d8f56c',
    });
    expect(result.colorHex).toBe('#D8F56C');
    expect(() => parseAddSpecification({ ...result, manufacturer: ' ' })).toThrow(
      BadRequestException,
    );
  });

  it('正常入库只能增加仓库数量', () => {
    expect(() =>
      parseStockMovement({ type: 'RECEIPT', bucket: 'INSTALLED', quantityDelta: 3 }),
    ).toThrow(BadRequestException);
  });

  it('库存调整必须提交实际数量、版本和原因', () => {
    expect(() =>
      parseStockMovement({
        requestKey: '11111111-1111-4111-8111-111111111111',
        type: 'ADJUSTMENT',
        bucket: 'WAREHOUSE',
        targetQuantity: 7,
        expectedVersion: 2,
      }),
    ).toThrow(BadRequestException);
    expect(
      parseStockMovement({
        requestKey: '11111111-1111-4111-8111-111111111111',
        type: 'ADJUSTMENT',
        bucket: 'WAREHOUSE',
        targetQuantity: 7,
        expectedVersion: 2,
        note: '现场复盘',
      }),
    ).toMatchObject({ targetQuantity: 7, expectedVersion: 2 });
  });

  it('撤销入库必须填写明确原因', () => {
    expect(() => parseReverseMovement({ reason: ' ' })).toThrow(BadRequestException);
    expect(parseReverseMovement({ reason: '数量录入错误' }).reason).toBe('数量录入错误');
  });

  it('初始化按现实快照校验仓库与已上墙总数', () => {
    const batchId = 'clz1234567890abcdefghijkl';
    expect(() =>
      parseInitializeSpecification({ batchId, warehouseQuantity: 0, installedQuantity: 0 }),
    ).toThrow(BadRequestException);
    expect(
      parseInitializeSpecification({ batchId, warehouseQuantity: 2, installedQuantity: 3 }),
    ).toMatchObject({ warehouseQuantity: 2, installedQuantity: 3 });
  });

  it('采集会话明确区分新建档案与补充已有模型', () => {
    const id = 'clz1234567890abcdefghijkl';
    expect(
      parseCreateScan({ mode: HoldScanMode.CREATE_SPECIFICATION, categoryId: id }),
    ).toMatchObject({ categoryId: id });
    expect(
      parseCreateScan({ mode: HoldScanMode.ENRICH_SPECIFICATION, specificationId: id }),
    ).toMatchObject({ specificationId: id });
    expect(() => parseCreateScan({ mode: HoldScanMode.ENRICH_SPECIFICATION })).toThrow(
      BadRequestException,
    );
  });
});
