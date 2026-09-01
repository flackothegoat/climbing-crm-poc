import type { CameraRoi, CameraRouteHold, CameraRoutePoint } from './camera-live-api';

interface PixelBuffer {
  data: Uint8ClampedArray;
  width: number;
  height: number;
}

interface ColorFeatures {
  cluster: number;
  saturation: number;
  value: number;
}

interface GridPoint {
  x: number;
  y: number;
}

/**
 * Produces object-shaped hold candidates rather than one ellipse per hue fragment.
 * Color is deliberately classified after connected components are formed, so a
 * highlight or shadow on a hold does not create another candidate by itself.
 */
export function detectHoldCandidates(image: PixelBuffer, roi: CameraRoi): CameraRouteHold[] {
  const { width, height, data } = image;
  const left = Math.max(0, Math.floor(roi.x1 * width));
  const top = Math.max(0, Math.floor(roi.y1 * height));
  const right = Math.min(width, Math.ceil(roi.x2 * width));
  const bottom = Math.min(height, Math.ceil(roi.y2 * height));
  const roiArea = Math.max(1, (right - left) * (bottom - top));
  const minimumArea = Math.max(12, Math.round(roiArea * 0.00004));
  // Large volumes can occupy a meaningful part of a tightly drawn route ROI.
  const maximumArea = Math.round(roiArea * 0.25);
  const chromaticMask = new Uint8Array(width * height);
  const hueClusters = new Int8Array(width * height).fill(-1);
  const wallValue = estimateWallValue(data, width, left, top, right, bottom);
  const darkObjectCutoff = Math.max(0.18, Math.min(0.42, wallValue - 0.24));

  for (let y = top; y < bottom; y += 1) {
    for (let x = left; x < right; x += 1) {
      const offset = (y * width + x) * 4;
      const features = colorFeatures(data[offset]!, data[offset + 1]!, data[offset + 2]!);
      const isChromaticObject = features.saturation >= 0.22 && features.value >= 0.14;
      const isDarkObject =
        features.saturation < 0.22 && features.value >= 0.05 && features.value <= darkObjectCutoff;
      // The wall reference is estimated per ROI. This keeps the rule independent
      // of a particular camera/exposure and includes black holds while excluding
      // the known grey-white wall and all white objects.
      if (isChromaticObject || isDarkObject) {
        const index = y * width + x;
        chromaticMask[index] = 1;
        hueClusters[index] = isDarkObject ? 12 : features.cluster;
      }
    }
  }

  // Keep the raw mask. Closing/dilation here bridges the tiny real gaps between
  // dense holds and can turn an entire route into one selectable object.
  const mask = chromaticMask;
  const visited = new Uint8Array(width * height);
  const queue = new Int32Array(Math.max(1, roiArea));
  const candidates: CameraRouteHold[] = [];

  for (let y = top; y < bottom; y += 1) {
    for (let x = left; x < right; x += 1) {
      const root = y * width + x;
      if (!mask[root] || visited[root]) continue;
      const rootCluster = hueClusters[root]!;
      let head = 0;
      let tail = 1;
      queue[0] = root;
      visited[root] = 1;
      const pixels: number[] = [];

      while (head < tail) {
        const current = queue[head++]!;
        const currentX = current % width;
        const currentY = Math.floor(current / width);
        pixels.push(current);

        for (const next of [current - 1, current + 1, current - width, current + width]) {
          if (
            next < 0 ||
            next >= mask.length ||
            visited[next] ||
            !mask[next] ||
            colorClusterDistance(rootCluster, hueClusters[next]!) > 2
          ) {
            continue;
          }
          const nextX = next % width;
          const nextY = Math.floor(next / width);
          if (nextX < left || nextX >= right || nextY < top || nextY >= bottom) continue;
          if (Math.abs(nextX - currentX) + Math.abs(nextY - currentY) !== 1) continue;
          visited[next] = 1;
          queue[tail++] = next;
        }
      }

      const partitions = splitAtNarrowBridges(pixels, width, minimumArea);
      for (const partition of partitions) {
        const candidate = buildCandidate({
          data,
          height,
          hueClusters,
          left,
          minimumArea,
          maximumArea,
          partition,
          right,
          top,
          bottom,
          wallValue,
          width,
        });
        if (candidate) candidates.push(candidate);
      }
    }
  }

  return candidates
    .filter((candidate) => candidate.confidence === undefined || candidate.confidence >= 0.35)
    .sort((a, b) => a.y - b.y || a.x - b.x)
    .slice(0, 256);
}

function buildCandidate(input: {
  data: Uint8ClampedArray;
  height: number;
  hueClusters: Int8Array;
  left: number;
  minimumArea: number;
  maximumArea: number;
  partition: number[];
  right: number;
  top: number;
  bottom: number;
  wallValue: number;
  width: number;
}): CameraRouteHold | null {
  const { data, height, hueClusters, minimumArea, maximumArea, partition, wallValue, width } =
    input;
  const bounds = pixelBounds(partition, width);
  const boxWidth = bounds.maxX - bounds.minX + 1;
  const boxHeight = bounds.maxY - bounds.minY + 1;
  const count = partition.length;
  const fillRatio = count / (boxWidth * boxHeight);
  const aspectRatio = Math.max(boxWidth / boxHeight, boxHeight / boxWidth);
  if (
    count < minimumArea ||
    count > maximumArea ||
    boxWidth < 4 ||
    boxHeight < 4 ||
    fillRatio < 0.1 ||
    aspectRatio > 8
  ) {
    return null;
  }

  let red = 0;
  let green = 0;
  let blue = 0;
  let saturation = 0;
  let contrastFromWall = 0;
  const clusterCounts = new Uint32Array(13);
  for (const pixel of partition) {
    const offset = pixel * 4;
    const features = colorFeatures(data[offset]!, data[offset + 1]!, data[offset + 2]!);
    red += data[offset]!;
    green += data[offset + 1]!;
    blue += data[offset + 2]!;
    saturation += features.saturation;
    contrastFromWall += Math.max(0, wallValue - features.value);
    clusterCounts[hueClusters[pixel]!] += 1;
  }

  const polygon = componentPolygon(
    partition,
    width,
    height,
    bounds.minX,
    bounds.minY,
    bounds.maxX,
    bounds.maxY,
  );
  if (polygon.length < 3) return null;
  const average = [red / count, green / count, blue / count].map(Math.round);
  const cluster = dominantCluster(clusterCounts);
  const confidence = candidateConfidence({
    averageSaturation: saturation / count,
    averageWallContrast: contrastFromWall / count,
    fillRatio,
    area: count,
    minimumArea,
    touchesBoundary:
      bounds.minX <= input.left ||
      bounds.maxX >= input.right - 1 ||
      bounds.minY <= input.top ||
      bounds.maxY >= input.bottom - 1,
  });

  return {
    id: `auto-${cluster}-${Math.round((bounds.minX + bounds.maxX) / 2)}-${Math.round((bounds.minY + bounds.maxY) / 2)}`,
    x: (bounds.minX + bounds.maxX + 1) / 2 / width,
    y: (bounds.minY + bounds.maxY + 1) / 2 / height,
    width: Math.max(0.002, boxWidth / width),
    height: Math.max(0.002, boxHeight / height),
    polygon,
    colorHex: rgbHex(average[0]!, average[1]!, average[2]!),
    colorCluster: clusterLabel(cluster),
    confidence,
    source: 'AUTO_COLOR',
    modelVersion: 'adaptive-watershed-v5',
  };
}

function splitAtNarrowBridges(pixels: number[], imageWidth: number, minimumArea: number) {
  const bounds = pixelBounds(pixels, imageWidth);
  const localWidth = bounds.maxX - bounds.minX + 1;
  const localHeight = bounds.maxY - bounds.minY + 1;
  const fillRatio = pixels.length / (localWidth * localHeight);
  // A dense group can be tall, wide, or nearly square depending on camera angle
  // and route layout. Aspect ratio is therefore not evidence of a single hold.
  // Low occupancy is the useful signal: several rounded holds connected by thin
  // colour bridges leave substantially more empty space in their combined box.
  const suspiciousMerge = pixels.length >= minimumArea * 3 && fillRatio <= 0.72;
  if (!suspiciousMerge) return [pixels];

  const original = new Uint8Array(localWidth * localHeight);
  for (const pixel of pixels) {
    const x = (pixel % imageWidth) - bounds.minX;
    const y = Math.floor(pixel / imageWidth) - bounds.minY;
    original[y * localWidth + x] = 1;
  }

  let eroded = original;
  const maximumIterations = Math.max(
    1,
    Math.min(5, Math.floor(Math.min(localWidth, localHeight) * 0.12)),
  );
  for (let iteration = 1; iteration <= maximumIterations; iteration += 1) {
    eroded = erodeLocalMask(eroded, localWidth, localHeight);
    const minimumSeedArea = Math.max(4, Math.round(minimumArea * 0.3));
    const seeds = localComponents(eroded, localWidth, localHeight).filter(
      (component) => component.length >= minimumSeedArea,
    );
    if (seeds.length < 2) continue;
    if (seeds.length > 12) break;
    const partitions = propagateSeeds(original, seeds, localWidth, localHeight)
      .map((partition) =>
        partition.map((localIndex) => {
          const x = localIndex % localWidth;
          const y = Math.floor(localIndex / localWidth);
          return (bounds.minY + y) * imageWidth + bounds.minX + x;
        }),
      )
      .filter((partition) => partition.length >= minimumArea);
    const retainedArea = partitions.reduce((sum, partition) => sum + partition.length, 0);
    const largestArea = Math.max(...partitions.map((partition) => partition.length), 0);
    if (
      partitions.length >= 2 &&
      retainedArea >= pixels.length * 0.9 &&
      largestArea <= pixels.length * 0.84
    ) {
      return partitions;
    }
  }

  // Thick projected bridges can survive every erosion pass. In that case each
  // physical hold still has a thick interior (a local distance maximum), while
  // the accidental bridge is thinner. Those maxima become marker seeds for a
  // second, shape-only watershed; no colour name or camera-specific coordinate
  // participates in this decision.
  const enclosedHoles = countEnclosedHoles(original, localWidth, localHeight);
  const peakSeeds =
    enclosedHoles === 1 ? [] : distancePeakSeeds(original, localWidth, localHeight, minimumArea);
  if (peakSeeds.length >= 2) {
    const partitions = propagateSeeds(original, peakSeeds, localWidth, localHeight)
      .map((partition) =>
        partition.map((localIndex) => {
          const x = localIndex % localWidth;
          const y = Math.floor(localIndex / localWidth);
          return (bounds.minY + y) * imageWidth + bounds.minX + x;
        }),
      )
      .filter((partition) => partition.length >= minimumArea);
    const retainedArea = partitions.reduce((sum, partition) => sum + partition.length, 0);
    const largestArea = Math.max(...partitions.map((partition) => partition.length), 0);
    if (
      partitions.length >= 2 &&
      retainedArea >= pixels.length * 0.9 &&
      largestArea <= pixels.length * 0.84
    ) {
      return partitions;
    }
  }
  return [pixels];
}

function countEnclosedHoles(mask: Uint8Array, width: number, height: number) {
  const visited = new Uint8Array(mask.length);
  const queue = new Int32Array(mask.length);
  let holes = 0;
  for (let root = 0; root < mask.length; root += 1) {
    if (mask[root] || visited[root]) continue;
    let head = 0;
    let tail = 1;
    let touchesBoundary = false;
    queue[0] = root;
    visited[root] = 1;
    while (head < tail) {
      const current = queue[head++]!;
      const x = current % width;
      const y = Math.floor(current / width);
      if (x === 0 || x === width - 1 || y === 0 || y === height - 1) touchesBoundary = true;
      for (const next of [current - 1, current + 1, current - width, current + width]) {
        if (next < 0 || next >= mask.length || visited[next] || mask[next]) continue;
        const nextX = next % width;
        const nextY = Math.floor(next / width);
        if (Math.abs(nextX - x) + Math.abs(nextY - y) !== 1) continue;
        visited[next] = 1;
        queue[tail++] = next;
      }
    }
    if (!touchesBoundary) holes += 1;
  }
  return holes;
}

function distancePeakSeeds(mask: Uint8Array, width: number, height: number, minimumArea: number) {
  const unreachable = 0xffff;
  const distances = new Uint16Array(mask.length);
  distances.fill(unreachable);
  for (let index = 0; index < mask.length; index += 1) {
    if (!mask[index]) distances[index] = 0;
  }

  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const index = y * width + x;
      if (!mask[index]) continue;
      const left = x > 0 ? distances[index - 1]! : 0;
      const up = y > 0 ? distances[index - width]! : 0;
      distances[index] = Math.min(distances[index]!, left + 1, up + 1);
    }
  }
  for (let y = height - 1; y >= 0; y -= 1) {
    for (let x = width - 1; x >= 0; x -= 1) {
      const index = y * width + x;
      if (!mask[index]) continue;
      const right = x + 1 < width ? distances[index + 1]! : 0;
      const down = y + 1 < height ? distances[index + width]! : 0;
      distances[index] = Math.min(distances[index]!, right + 1, down + 1);
    }
  }

  let maximumDepth = 0;
  for (const distance of distances) {
    if (distance !== unreachable) maximumDepth = Math.max(maximumDepth, distance);
  }
  const minimumDepth = Math.max(
    3,
    Math.min(maximumDepth, Math.round(Math.sqrt(minimumArea) * 0.45)),
  );
  const peaks: Array<{ index: number; depth: number; x: number; y: number }> = [];
  for (let y = 1; y < height - 1; y += 1) {
    for (let x = 1; x < width - 1; x += 1) {
      const index = y * width + x;
      const depth = distances[index]!;
      if (!mask[index] || depth < minimumDepth || depth < maximumDepth * 0.42) continue;
      let hasDeeperNeighbour = false;
      for (let offsetY = -1; offsetY <= 1; offsetY += 1) {
        for (let offsetX = -1; offsetX <= 1; offsetX += 1) {
          if (!offsetX && !offsetY) continue;
          if (distances[(y + offsetY) * width + x + offsetX]! > depth) {
            hasDeeperNeighbour = true;
          }
        }
      }
      if (!hasDeeperNeighbour) peaks.push({ index, depth, x, y });
    }
  }
  peaks.sort((a, b) => b.depth - a.depth || a.index - b.index);

  const accepted: typeof peaks = [];
  for (const peak of peaks) {
    if (accepted.length >= 12) break;
    const overlapsExisting = accepted.some((other) => {
      const minimumDistance = Math.max(6, Math.max(peak.depth, other.depth) * 2);
      return (peak.x - other.x) ** 2 + (peak.y - other.y) ** 2 < minimumDistance ** 2;
    });
    if (!overlapsExisting) accepted.push(peak);
  }

  return accepted.map((peak) => {
    const radius = Math.max(1, Math.floor(peak.depth * 0.3));
    const seed: number[] = [];
    for (let y = Math.max(0, peak.y - radius); y <= Math.min(height - 1, peak.y + radius); y += 1) {
      for (
        let x = Math.max(0, peak.x - radius);
        x <= Math.min(width - 1, peak.x + radius);
        x += 1
      ) {
        const index = y * width + x;
        if (mask[index] && (x - peak.x) ** 2 + (y - peak.y) ** 2 <= radius ** 2) {
          seed.push(index);
        }
      }
    }
    return seed;
  });
}

function erodeLocalMask(source: Uint8Array, width: number, height: number) {
  const result = new Uint8Array(source.length);
  for (let y = 1; y < height - 1; y += 1) {
    for (let x = 1; x < width - 1; x += 1) {
      const index = y * width + x;
      if (
        source[index] &&
        source[index - 1] &&
        source[index + 1] &&
        source[index - width] &&
        source[index + width]
      ) {
        result[index] = 1;
      }
    }
  }
  return result;
}

function localComponents(mask: Uint8Array, width: number, height: number) {
  const visited = new Uint8Array(mask.length);
  const queue = new Int32Array(mask.length);
  const components: number[][] = [];
  for (let root = 0; root < mask.length; root += 1) {
    if (!mask[root] || visited[root]) continue;
    let head = 0;
    let tail = 1;
    queue[0] = root;
    visited[root] = 1;
    const component: number[] = [];
    while (head < tail) {
      const current = queue[head++]!;
      component.push(current);
      const x = current % width;
      const y = Math.floor(current / width);
      for (const next of [current - 1, current + 1, current - width, current + width]) {
        if (next < 0 || next >= mask.length || visited[next] || !mask[next]) continue;
        const nextX = next % width;
        const nextY = Math.floor(next / width);
        if (nextX < 0 || nextX >= width || nextY < 0 || nextY >= height) continue;
        if (Math.abs(nextX - x) + Math.abs(nextY - y) !== 1) continue;
        visited[next] = 1;
        queue[tail++] = next;
      }
    }
    components.push(component);
  }
  return components;
}

function propagateSeeds(mask: Uint8Array, seeds: number[][], width: number, height: number) {
  const labels = new Int16Array(mask.length).fill(-1);
  const queue = new Int32Array(mask.length);
  let head = 0;
  let tail = 0;
  seeds.forEach((seed, label) => {
    for (const index of seed) {
      labels[index] = label;
      queue[tail++] = index;
    }
  });
  while (head < tail) {
    const current = queue[head++]!;
    const x = current % width;
    const y = Math.floor(current / width);
    for (const next of [current - 1, current + 1, current - width, current + width]) {
      if (next < 0 || next >= mask.length || !mask[next] || labels[next] >= 0) continue;
      const nextX = next % width;
      const nextY = Math.floor(next / width);
      if (nextX < 0 || nextX >= width || nextY < 0 || nextY >= height) continue;
      if (Math.abs(nextX - x) + Math.abs(nextY - y) !== 1) continue;
      labels[next] = labels[current]!;
      queue[tail++] = next;
    }
  }
  const partitions = seeds.map(() => [] as number[]);
  for (let index = 0; index < labels.length; index += 1) {
    const label = labels[index]!;
    if (label >= 0) partitions[label]!.push(index);
  }
  return partitions;
}

function pixelBounds(pixels: number[], width: number) {
  let minX = Number.POSITIVE_INFINITY;
  let maxX = 0;
  let minY = Number.POSITIVE_INFINITY;
  let maxY = 0;
  for (const pixel of pixels) {
    const x = pixel % width;
    const y = Math.floor(pixel / width);
    minX = Math.min(minX, x);
    maxX = Math.max(maxX, x);
    minY = Math.min(minY, y);
    maxY = Math.max(maxY, y);
  }
  return { minX, maxX, minY, maxY };
}

export function componentPolygon(
  pixels: number[],
  imageWidth: number,
  imageHeight: number,
  minX: number,
  minY: number,
  maxX: number,
  maxY: number,
): CameraRoutePoint[] {
  const localWidth = maxX - minX + 1;
  const localHeight = maxY - minY + 1;
  const local = new Uint8Array(localWidth * localHeight);
  for (const pixel of pixels) {
    const x = (pixel % imageWidth) - minX;
    const y = Math.floor(pixel / imageWidth) - minY;
    local[y * localWidth + x] = 1;
  }

  const edges = new Map<string, GridPoint[]>();
  const addEdge = (from: GridPoint, to: GridPoint) => {
    const key = pointKey(from);
    const values = edges.get(key) ?? [];
    values.push(to);
    edges.set(key, values);
  };
  const isFilled = (x: number, y: number) =>
    x >= 0 && x < localWidth && y >= 0 && y < localHeight && Boolean(local[y * localWidth + x]);

  for (let y = 0; y < localHeight; y += 1) {
    for (let x = 0; x < localWidth; x += 1) {
      if (!isFilled(x, y)) continue;
      const globalX = minX + x;
      const globalY = minY + y;
      if (!isFilled(x, y - 1)) addEdge({ x: globalX, y: globalY }, { x: globalX + 1, y: globalY });
      if (!isFilled(x + 1, y))
        addEdge({ x: globalX + 1, y: globalY }, { x: globalX + 1, y: globalY + 1 });
      if (!isFilled(x, y + 1))
        addEdge({ x: globalX + 1, y: globalY + 1 }, { x: globalX, y: globalY + 1 });
      if (!isFilled(x - 1, y)) addEdge({ x: globalX, y: globalY + 1 }, { x: globalX, y: globalY });
    }
  }

  const loops: GridPoint[][] = [];
  while (edges.size) {
    const first = edges.entries().next().value as [string, GridPoint[]] | undefined;
    if (!first) break;
    const start = parsePointKey(first[0]);
    const loop: GridPoint[] = [start];
    let current = start;
    let guard = 0;
    while (guard < pixels.length * 6 + 20) {
      guard += 1;
      const key = pointKey(current);
      const options = edges.get(key);
      const next = options?.pop();
      if (!options?.length) edges.delete(key);
      if (!next) break;
      if (next.x === start.x && next.y === start.y) {
        loops.push(loop);
        break;
      }
      loop.push(next);
      current = next;
    }
  }

  const outer = loops.sort((a, b) => Math.abs(polygonArea(b)) - Math.abs(polygonArea(a)))[0] ?? [];
  const simplified = simplifyClosedPolygon(outer, Math.max(1, Math.sqrt(pixels.length) * 0.018));
  return simplified.slice(0, 192).map((point) => ({
    x: clamp(point.x / imageWidth),
    y: clamp(point.y / imageHeight),
  }));
}

function simplifyClosedPolygon(points: GridPoint[], tolerance: number) {
  if (points.length <= 8) return points;
  const anchorIndex = points.reduce(
    (best, point, index) => (point.x < points[best]!.x ? index : best),
    0,
  );
  const rotated = [
    ...points.slice(anchorIndex),
    ...points.slice(0, anchorIndex),
    points[anchorIndex]!,
  ];
  const simplified = simplifyLine(rotated, tolerance);
  if (simplified.length > 1) simplified.pop();
  return simplified.length >= 3 ? simplified : points;
}

function simplifyLine(points: GridPoint[], tolerance: number): GridPoint[] {
  if (points.length <= 2) return points;
  let maximumDistance = 0;
  let splitIndex = 0;
  for (let index = 1; index < points.length - 1; index += 1) {
    const distance = perpendicularDistance(points[index]!, points[0]!, points[points.length - 1]!);
    if (distance > maximumDistance) {
      maximumDistance = distance;
      splitIndex = index;
    }
  }
  if (maximumDistance <= tolerance) return [points[0]!, points[points.length - 1]!];
  const left = simplifyLine(points.slice(0, splitIndex + 1), tolerance);
  const right = simplifyLine(points.slice(splitIndex), tolerance);
  return [...left.slice(0, -1), ...right];
}

function perpendicularDistance(point: GridPoint, start: GridPoint, end: GridPoint) {
  const dx = end.x - start.x;
  const dy = end.y - start.y;
  if (dx === 0 && dy === 0) return Math.hypot(point.x - start.x, point.y - start.y);
  return (
    Math.abs(dy * point.x - dx * point.y + end.x * start.y - end.y * start.x) / Math.hypot(dx, dy)
  );
}

function polygonArea(points: GridPoint[]) {
  return (
    points.reduce((area, point, index) => {
      const next = points[(index + 1) % points.length]!;
      return area + point.x * next.y - next.x * point.y;
    }, 0) / 2
  );
}

function pointKey(point: GridPoint) {
  return `${point.x},${point.y}`;
}

function parsePointKey(key: string): GridPoint {
  const [x, y] = key.split(',').map(Number);
  return { x: x!, y: y! };
}

function dominantCluster(counts: Uint32Array) {
  let cluster = 0;
  for (let index = 1; index < counts.length; index += 1) {
    if (counts[index]! > counts[cluster]!) cluster = index;
  }
  return cluster;
}

function candidateConfidence(input: {
  averageSaturation: number;
  averageWallContrast: number;
  fillRatio: number;
  area: number;
  minimumArea: number;
  touchesBoundary: boolean;
}) {
  const saturationScore = clamp((input.averageSaturation - 0.18) / 0.55);
  const contrastScore = clamp((input.averageWallContrast - 0.16) / 0.38);
  const objectSeparationScore = Math.max(saturationScore, contrastScore);
  const solidityScore = clamp(input.fillRatio / 0.55);
  const areaScore = clamp(input.area / (input.minimumArea * 4));
  const boundaryPenalty = input.touchesBoundary ? 0.12 : 0;
  return (
    Math.round(
      clamp(
        0.48 * objectSeparationScore + 0.3 * solidityScore + 0.22 * areaScore - boundaryPenalty,
      ) * 100,
    ) / 100
  );
}

function colorFeatures(red: number, green: number, blue: number): ColorFeatures {
  const r = red / 255;
  const g = green / 255;
  const b = blue / 255;
  const maximum = Math.max(r, g, b);
  const minimum = Math.min(r, g, b);
  const delta = maximum - minimum;
  const saturation = maximum === 0 ? 0 : delta / maximum;
  if (saturation < 0.08 || maximum < 0.1) {
    return { cluster: -1, saturation, value: maximum };
  }
  let hue = 0;
  if (delta > 0 && maximum === r) hue = 60 * (((g - b) / delta) % 6);
  else if (delta > 0 && maximum === g) hue = 60 * ((b - r) / delta + 2);
  else if (delta > 0) hue = 60 * ((r - g) / delta + 4);
  if (hue < 0) hue += 360;
  return { cluster: Math.min(11, Math.floor(hue / 30)), saturation, value: maximum };
}

function colorClusterDistance(first: number, second: number) {
  if (first < 0 || second < 0) return Number.POSITIVE_INFINITY;
  if (first >= 12 || second >= 12) return first === second ? 0 : Number.POSITIVE_INFINITY;
  const direct = Math.abs(first - second);
  return Math.min(direct, 12 - direct);
}

function clusterLabel(cluster: number) {
  if (cluster === 12) return 'dark';
  return `hue-${cluster}`;
}

function estimateWallValue(
  data: Uint8ClampedArray,
  width: number,
  left: number,
  top: number,
  right: number,
  bottom: number,
) {
  const histogram = new Uint32Array(256);
  let sampleCount = 0;
  const stride = Math.max(1, Math.floor(Math.sqrt(((right - left) * (bottom - top)) / 120_000)));
  for (let y = top; y < bottom; y += stride) {
    for (let x = left; x < right; x += stride) {
      const offset = (y * width + x) * 4;
      const features = colorFeatures(data[offset]!, data[offset + 1]!, data[offset + 2]!);
      if (features.saturation <= 0.16 && features.value >= 0.35) {
        histogram[Math.round(features.value * 255)] += 1;
        sampleCount += 1;
      }
    }
  }
  if (!sampleCount) return 0.72;
  const target = Math.ceil(sampleCount * 0.55);
  let cumulative = 0;
  for (let index = 0; index < histogram.length; index += 1) {
    cumulative += histogram[index]!;
    if (cumulative >= target) return index / 255;
  }
  return 0.72;
}

function rgbHex(red: number, green: number, blue: number) {
  return `#${[red, green, blue]
    .map((value) => Math.max(0, Math.min(255, value)).toString(16).padStart(2, '0'))
    .join('')}`.toUpperCase();
}

function clamp(value: number) {
  return Math.max(0, Math.min(1, value));
}
