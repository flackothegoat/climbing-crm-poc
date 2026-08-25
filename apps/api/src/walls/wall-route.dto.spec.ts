import { ClimbingColor } from '@prisma/client';
import { describe, expect, it } from 'vitest';
import { parseCreateObservation, parseSaveRouteSettingPlan } from './wall-route.dto';

describe('墙面线路 DTO', () => {
  it('拒绝引用不存在路线的安装位置', () => {
    expect(() =>
      parseSaveRouteSettingPlan({
        schemaVersion: 1,
        settingJobId: 'job-1',
        revision: 0,
        wall: { code: 'W06' },
        routes: [{ id: 'route-green', name: '青苔', color: ClimbingColor.GREEN, grade: 'V2' }],
        placements: [
          {
            id: 'placement-1',
            assetId: 'test-green',
            routeId: 'route-other',
            holeId: 'W06-C01-R01',
            role: 'START',
            rotationDegrees: 0,
          },
        ],
        updatedAt: '2026-08-06T10:00:00+08:00',
      }),
    ).toThrow('岩点位置引用了不存在的线路');
  });

  it('人工事件必须提供 UUID 幂等键和明确时间', () => {
    const parsed = parseCreateObservation({
      wallCode: 'w06',
      routeId: 'route-green',
      outcome: 'COMPLETED',
      observedAt: '2026-08-06T10:00:00+08:00',
      requestKey: '75fc093c-974b-4b14-9d79-cd024be97319',
    });
    expect(parsed.wallCode).toBe('W06');
    expect(parsed.outcome).toBe('COMPLETED');
  });

  it('拒绝保存没有任何岩点的空线路', () => {
    expect(() =>
      parseSaveRouteSettingPlan({
        schemaVersion: 1,
        settingJobId: 'job-1',
        revision: 0,
        wall: { code: 'W06' },
        routes: [{ id: 'route-empty', name: '空线路', color: ClimbingColor.GREEN, grade: 'V2' }],
        placements: [],
        updatedAt: '2026-08-06T10:00:00+08:00',
      }),
    ).toThrow('线路至少需要一个岩点位置');
  });
});
