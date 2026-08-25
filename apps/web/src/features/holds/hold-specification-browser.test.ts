import { describe, expect, it } from 'vitest';
import type { HoldSpecification } from './hold-api';
import { emptySpecificationFilters, filterHoldSpecifications } from './hold-specification-browser';

describe('filterHoldSpecifications', () => {
  const items = [
    buildSpecification({
      id: 'yellow-jug',
      productName: '三角大把手',
      color: 'YELLOW',
      manufacturer: 'Rock',
      sizeClass: 'M',
      sku: 'ROCK-01',
      assets: [buildModelAsset()],
    }),
    buildSpecification({
      id: 'purple-jug',
      productName: '长方形大把手',
      color: 'PURPLE',
      manufacturer: 'EP',
      sizeClass: 'L',
      status: 'ARCHIVED',
    }),
  ];

  it('searches business fields without case sensitivity', () => {
    const result = filterHoldSpecifications(items, {
      ...emptySpecificationFilters,
      query: 'rock-01',
    });

    expect(result.map((item) => item.id)).toEqual(['yellow-jug']);
  });

  it('combines color, size, model and status filters', () => {
    const activeModel = filterHoldSpecifications(items, {
      ...emptySpecificationFilters,
      color: 'YELLOW',
      size: 'M',
      model: 'WITH_MODEL',
      status: 'ACTIVE',
    });
    const stoppedWithoutModel = filterHoldSpecifications(items, {
      ...emptySpecificationFilters,
      model: 'WITHOUT_MODEL',
      status: 'ARCHIVED',
    });

    expect(activeModel.map((item) => item.id)).toEqual(['yellow-jug']);
    expect(stoppedWithoutModel.map((item) => item.id)).toEqual(['purple-jug']);
  });
});

function buildSpecification(
  overrides: Partial<HoldSpecification> & Pick<HoldSpecification, 'id' | 'productName'>,
): HoldSpecification {
  return {
    productModelId: `${overrides.id}-model`,
    manufacturer: null,
    style: null,
    sizeClass: 'S',
    widthMm: null,
    heightMm: null,
    depthMm: null,
    mountingType: 'BOLT_ON',
    color: 'GREEN',
    sku: null,
    status: 'ACTIVE',
    assets: [],
    inventory: {
      warehouseQuantity: 0,
      installedQuantity: 0,
      reservedQuantity: 0,
      maintenanceQuantity: 0,
      totalQuantity: 0,
      version: 1,
    },
    ...overrides,
  };
}

function buildModelAsset(): HoldSpecification['assets'][number] {
  return {
    id: 'model-asset',
    scanId: 'scan-1',
    kind: 'MODEL_3D',
    status: 'READY',
    originalFileName: 'hold.glb',
    contentType: 'model/gltf-binary',
    sizeBytes: 1024,
    metadata: null,
    sourceAssetId: null,
    createdAt: '2026-07-24T00:00:00.000Z',
  };
}
