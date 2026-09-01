import { describe, expect, it } from 'vitest';
import { detectHoldCandidates } from './detect-hold-candidates';

describe('通用岩点颜色候选检测', () => {
  it('在用户框选区域内发现独立的高饱和色块', () => {
    const width = 40;
    const height = 30;
    const data = new Uint8ClampedArray(width * height * 4);
    for (let index = 0; index < width * height; index += 1) {
      data.set([190, 195, 190, 255], index * 4);
    }
    for (let y = 10; y < 16; y += 1) {
      for (let x = 12; x < 19; x += 1) data.set([240, 190, 20, 255], (y * width + x) * 4);
    }
    const result = detectHoldCandidates(
      { data, width, height },
      { x1: 0.1, y1: 0.1, x2: 0.9, y2: 0.9 },
    );
    expect(result).toHaveLength(1);
    expect(result[0]).toMatchObject({ colorCluster: 'hue-1' });
    expect(result[0]!.x).toBeCloseTo(0.3875, 2);
    expect(result[0]!.polygon?.length).toBeGreaterThanOrEqual(4);
    expect(result[0]!.source).toBe('AUTO_COLOR');
  });

  it('忽略框选区域外的色块', () => {
    const width = 40;
    const height = 30;
    const data = new Uint8ClampedArray(width * height * 4);
    for (let index = 0; index < width * height; index += 1) {
      data.set([190, 195, 190, 255], index * 4);
    }
    for (let y = 2; y < 8; y += 1) {
      for (let x = 2; x < 9; x += 1) data.set([180, 30, 180, 255], (y * width + x) * 4);
    }
    expect(
      detectHoldCandidates({ data, width, height }, { x1: 0.3, y1: 0.3, x2: 0.9, y2: 0.9 }),
    ).toHaveLength(0);
  });

  it('先形成完整对象再分类颜色，不把同一岩点的不同色相拆开', () => {
    const width = 60;
    const height = 40;
    const data = wallImage(width, height);
    for (let y = 10; y < 27; y += 1) {
      for (let x = 15; x < 38; x += 1) {
        const color = x < 27 ? [220, 45, 60, 255] : [180, 35, 120, 255];
        data.set(color, (y * width + x) * 4);
      }
    }

    const result = detectHoldCandidates(
      { data, width, height },
      { x1: 0.05, y1: 0.05, x2: 0.95, y2: 0.95 },
    );

    expect(result).toHaveLength(1);
    expect(result[0]!.width).toBeCloseTo(23 / width, 2);
  });

  it('镂空处露出的灰墙不会成为第二个候选', () => {
    const width = 64;
    const height = 48;
    const data = wallImage(width, height);
    for (let y = 10; y < 36; y += 1) {
      for (let x = 16; x < 48; x += 1) {
        const outer = ((x - 32) / 16) ** 2 + ((y - 23) / 13) ** 2 <= 1;
        const hole = ((x - 32) / 6) ** 2 + ((y - 23) / 5) ** 2 <= 1;
        if (outer && !hole) data.set([230, 35, 75, 255], (y * width + x) * 4);
      }
    }

    const result = detectHoldCandidates(
      { data, width, height },
      { x1: 0.05, y1: 0.05, x2: 0.95, y2: 0.95 },
    );

    expect(result).toHaveLength(1);
    expect(result[0]!.polygon?.length).toBeGreaterThan(4);
  });

  it('密集岩点保留真实间隙，且不会把接触的异色岩点连成一组', () => {
    const width = 80;
    const height = 50;
    const data = wallImage(width, height);
    paintRect(data, width, 10, 12, 20, 28, [205, 35, 105, 255]);
    // One wall pixel is enough to prove these are two physical holds.
    paintRect(data, width, 22, 12, 32, 28, [215, 40, 115, 255]);
    // A blue hold touches the second pink hold in the projected image.
    paintRect(data, width, 33, 12, 43, 28, [25, 105, 220, 255]);

    const result = detectHoldCandidates(
      { data, width, height },
      { x1: 0.05, y1: 0.05, x2: 0.95, y2: 0.95 },
    );

    expect(result).toHaveLength(3);
    expect(result.filter((hold) => hold.colorCluster === 'hue-11')).toHaveLength(2);
    expect(result.filter((hold) => hold.colorCluster === 'hue-7')).toHaveLength(1);
  });

  it('对所有色系使用同一套分割规则，而不是写死特定颜色', () => {
    const width = 90;
    const height = 50;
    const data = wallImage(width, height);
    paintRect(data, width, 8, 12, 20, 28, [235, 190, 25, 255]);
    paintRect(data, width, 32, 12, 44, 28, [30, 185, 90, 255]);
    paintRect(data, width, 56, 12, 68, 28, [25, 175, 205, 255]);

    const result = detectHoldCandidates(
      { data, width, height },
      { x1: 0.02, y1: 0.05, x2: 0.98, y2: 0.95 },
    );

    expect(result).toHaveLength(3);
    expect(new Set(result.map((hold) => hold.colorCluster)).size).toBe(3);
    expect(result.every((hold) => hold.polygon && hold.polygon.length >= 4)).toBe(true);
  });

  it('基于当前灰白墙面自适应识别黑色岩点，但不识别白色块和普通墙面阴影', () => {
    const width = 100;
    const height = 60;
    const data = wallImage(width, height);
    paintRect(data, width, 10, 15, 28, 35, [28, 30, 29, 255]);
    paintRect(data, width, 40, 15, 58, 35, [245, 245, 245, 255]);
    paintRect(data, width, 70, 15, 88, 35, [130, 132, 130, 255]);

    const result = detectHoldCandidates(
      { data, width, height },
      { x1: 0.02, y1: 0.05, x2: 0.98, y2: 0.95 },
    );

    expect(result).toHaveLength(1);
    expect(result[0]).toMatchObject({
      colorCluster: 'dark',
      modelVersion: 'adaptive-watershed-v5',
    });
  });

  it('摄像头曝光变化后仍从画面估计墙面，而不是依赖固定灰度', () => {
    const width = 70;
    const height = 50;
    const data = wallImage(width, height, [150, 153, 150, 255]);
    paintRect(data, width, 20, 12, 42, 34, [25, 27, 26, 255]);

    const result = detectHoldCandidates(
      { data, width, height },
      { x1: 0.02, y1: 0.05, x2: 0.98, y2: 0.95 },
    );

    expect(result).toHaveLength(1);
    expect(result[0]!.colorCluster).toBe('dark');
  });

  it('把由窄像素桥连接的同色密集岩点拆成可独立选择的物理岩点', () => {
    const width = 80;
    const height = 50;
    const data = wallImage(width, height);
    paintDisk(data, width, 22, 25, 9, [210, 40, 115, 255]);
    paintDisk(data, width, 48, 25, 9, [212, 42, 118, 255]);
    paintRect(data, width, 30, 25, 41, 27, [211, 41, 116, 255]);

    const result = detectHoldCandidates(
      { data, width, height },
      { x1: 0.02, y1: 0.05, x2: 0.98, y2: 0.95 },
    );

    expect(result).toHaveLength(2);
    expect(result.every((hold) => hold.colorCluster === 'hue-11')).toBe(true);
    expect(result.every((hold) => hold.width < 0.35)).toBe(true);
  });

  it('密集岩点即使整体接近方形，也不依赖长宽比才拆分', () => {
    const width = 90;
    const height = 90;
    const data = wallImage(width, height);
    const color = [210, 40, 115, 255];
    const centers: Array<[number, number]> = [
      [24, 24],
      [45, 24],
      [56, 43],
      [42, 61],
      [22, 54],
    ];
    centers.forEach(([x, y]) => paintDisk(data, width, x, y, 7, color));
    for (let index = 1; index < centers.length; index += 1) {
      paintBridge(data, width, centers[index - 1]!, centers[index]!, color);
    }

    const result = detectHoldCandidates(
      { data, width, height },
      { x1: 0.02, y1: 0.02, x2: 0.98, y2: 0.98 },
    );

    expect(result).toHaveLength(5);
    expect(result.every((hold) => hold.colorCluster === 'hue-11')).toBe(true);
  });

  it('粗色桥在普通腐蚀后仍连通时，用距离峰值拆出每个岩点实例', () => {
    const width = 100;
    const height = 60;
    const data = wallImage(width, height);
    const color = [210, 40, 115, 255];
    paintDisk(data, width, 20, 18, 10, color);
    paintDisk(data, width, 48, 40, 10, color);
    paintDisk(data, width, 76, 18, 10, color);
    // Thick diagonal projected colour bridges survive the five erosion passes
    // while the whole component still has the sparse footprint of many holds.
    paintThickBridge(data, width, [27, 24], [41, 34], 6, color);
    paintThickBridge(data, width, [55, 34], [69, 24], 6, color);

    const result = detectHoldCandidates(
      { data, width, height },
      { x1: 0.02, y1: 0.05, x2: 0.98, y2: 0.95 },
    );

    expect(result).toHaveLength(3);
  });
});

function wallImage(width: number, height: number, color = [190, 195, 190, 255]) {
  const data = new Uint8ClampedArray(width * height * 4);
  for (let index = 0; index < width * height; index += 1) {
    data.set(color, index * 4);
  }
  return data;
}

function paintRect(
  data: Uint8ClampedArray,
  width: number,
  left: number,
  top: number,
  right: number,
  bottom: number,
  color: number[],
) {
  for (let y = top; y < bottom; y += 1) {
    for (let x = left; x < right; x += 1) data.set(color, (y * width + x) * 4);
  }
}

function paintDisk(
  data: Uint8ClampedArray,
  width: number,
  centerX: number,
  centerY: number,
  radius: number,
  color: number[],
) {
  for (let y = centerY - radius; y <= centerY + radius; y += 1) {
    for (let x = centerX - radius; x <= centerX + radius; x += 1) {
      if ((x - centerX) ** 2 + (y - centerY) ** 2 <= radius ** 2) {
        data.set(color, (y * width + x) * 4);
      }
    }
  }
}

function paintBridge(
  data: Uint8ClampedArray,
  width: number,
  from: [number, number],
  to: [number, number],
  color: number[],
) {
  const steps = Math.max(Math.abs(to[0] - from[0]), Math.abs(to[1] - from[1]));
  for (let step = 0; step <= steps; step += 1) {
    const x = Math.round(from[0] + ((to[0] - from[0]) * step) / steps);
    const y = Math.round(from[1] + ((to[1] - from[1]) * step) / steps);
    paintRect(data, width, x, y, x + 2, y + 2, color);
  }
}

function paintThickBridge(
  data: Uint8ClampedArray,
  width: number,
  from: [number, number],
  to: [number, number],
  radius: number,
  color: number[],
) {
  const steps = Math.max(Math.abs(to[0] - from[0]), Math.abs(to[1] - from[1]));
  for (let step = 0; step <= steps; step += 1) {
    const x = Math.round(from[0] + ((to[0] - from[0]) * step) / steps);
    const y = Math.round(from[1] + ((to[1] - from[1]) * step) / steps);
    paintDisk(data, width, x, y, radius, color);
  }
}
