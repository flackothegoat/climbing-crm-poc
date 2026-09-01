import { ClimbingColor } from '@prisma/client';
import { describe, expect, it } from 'vitest';
import { parseCreateRoute, parseSubmitFeedback } from './route-operations.dto';

describe('线路运营 DTO', () => {
  it('允许不包含三维孔位的跨墙段线路，并去重风格标签', () => {
    expect(
      parseCreateRoute({
        code: 'r-027',
        name: '晨雾',
        color: ClimbingColor.GREEN,
        grade: 'V3',
        gradeSystem: 'V',
        styleTags: ['平衡', '平衡', '脚法'],
        wallSegmentIds: ['wall-segment-0001', 'wall-segment-0002'],
      }),
    ).toMatchObject({
      code: 'R-027',
      styleTags: ['平衡', '脚法'],
      wallSegmentIds: ['wall-segment-0001', 'wall-segment-0002'],
    });
  });

  it('只接受统一业务颜色枚举，不接受英文小写或十六进制色值', () => {
    const base = {
      code: 'R-028',
      name: '青苔',
      grade: 'V2',
      gradeSystem: 'V',
      wallSegmentIds: ['wall-segment-0001'],
    };
    expect(() => parseCreateRoute({ ...base, color: 'green' })).toThrow();
    expect(() => parseCreateRoute({ ...base, color: '#22AA66' })).toThrow();
    expect(parseCreateRoute({ ...base, color: ClimbingColor.GREEN }).color).toBe(
      ClimbingColor.GREEN,
    );
  });

  it('视觉配置创建线路时允许省略由服务器生成的线路编号', () => {
    expect(
      parseCreateRoute({
        name: '黄色测试线',
        color: ClimbingColor.YELLOW,
        grade: 'V4',
        gradeSystem: 'V',
        wallSegmentIds: ['wall-segment-0001'],
      }).code,
    ).toBeUndefined();
  });

  it('拒绝二维码反馈携带过长文本', () => {
    expect(() =>
      parseSubmitFeedback({
        outcome: 'COMPLETED',
        difficulty: 'AS_EXPECTED',
        enjoyment: 'LIKE',
        anonymousSessionId: 'anonymous-session-0001',
        requestKey: crypto.randomUUID(),
        comment: '过'.repeat(301),
      }),
    ).toThrow();
  });
});
