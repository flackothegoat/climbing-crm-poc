import { describe, expect, it } from 'vitest';
import { parseSaveCameraRouteDefinition } from './camera-route-definition.dto';

const valid = {
  routeId: 'route-camera-01',
  routeVersionId: 'route-version-camera-01',
  wallSegmentId: 'wall-segment-camera-01',
  referenceWidth: 1280,
  referenceHeight: 720,
  roi: { x1: 0.1, y1: 0.1, x2: 0.9, y2: 0.95 },
  holds: [
    {
      id: 'hold-1',
      x: 0.2,
      y: 0.8,
      width: 0.04,
      height: 0.05,
      colorHex: '#F2C94C',
      colorCluster: 'hue-2',
    },
    {
      id: 'hold-2',
      x: 0.7,
      y: 0.2,
      width: 0.04,
      height: 0.05,
      colorHex: '#F2C94C',
      colorCluster: 'hue-2',
    },
  ],
  startHoldIds: ['hold-1'],
  finishHoldIds: ['hold-2'],
};

describe('摄像头线路定义 DTO', () => {
  it('接受归一化岩点、起点和终点', () => {
    expect(parseSaveCameraRouteDefinition(valid).holds).toHaveLength(2);
  });

  it('接受自动分割生成的轮廓和质量元数据', () => {
    const parsed = parseSaveCameraRouteDefinition({
      ...valid,
      holds: valid.holds.map((hold) => ({
        ...hold,
        polygon: [
          { x: hold.x - 0.01, y: hold.y - 0.01 },
          { x: hold.x + 0.01, y: hold.y - 0.01 },
          { x: hold.x, y: hold.y + 0.01 },
        ],
        confidence: 0.86,
        source: 'AUTO_COLOR',
        modelVersion: 'color-contour-v2',
      })),
    });

    expect(parsed.holds[0]).toMatchObject({
      confidence: 0.86,
      source: 'AUTO_COLOR',
      modelVersion: 'color-contour-v2',
    });
    expect(parsed.holds[0]!.polygon).toHaveLength(3);
  });

  it('拒绝不属于线路的终点', () => {
    expect(() =>
      parseSaveCameraRouteDefinition({ ...valid, finishHoldIds: ['hold-missing'] }),
    ).toThrow();
  });

  it('拒绝过小的识别区域', () => {
    expect(() =>
      parseSaveCameraRouteDefinition({
        ...valid,
        roi: { x1: 0.1, y1: 0.1, x2: 0.11, y2: 0.95 },
      }),
    ).toThrow();
  });
});
