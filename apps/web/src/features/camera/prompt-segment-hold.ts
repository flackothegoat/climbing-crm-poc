import type { ProgressCallback } from '@huggingface/transformers';
import type { CameraRoi, CameraRouteHold } from './camera-live-api';
import { componentPolygon } from './detect-hold-candidates';

const MODEL_ID = process.env.NEXT_PUBLIC_SAM_MODEL_ID?.trim() || 'Xenova/slimsam-77-uniform';
const MODEL_VERSION = 'slimsam-77-uniform-q8';

interface TensorLike {
  data: ArrayLike<number>;
  dims: number[];
}

interface SamInputs {
  pixel_values: unknown;
  original_sizes: Array<[number, number]>;
  reshaped_input_sizes: Array<[number, number]>;
  input_points?: unknown;
  input_labels?: unknown;
  input_boxes?: unknown;
}

interface SamOutputs {
  pred_masks: TensorLike;
  iou_scores: TensorLike;
}

interface SamRuntime {
  RawImage: {
    fromCanvas(canvas: HTMLCanvasElement): unknown;
  };
  model: {
    (inputs: Record<string, unknown>): Promise<SamOutputs>;
    get_image_embeddings(inputs: { pixel_values: unknown }): Promise<Record<string, unknown>>;
  };
  processor: {
    (image: unknown, options?: Record<string, unknown>): Promise<SamInputs>;
    post_process_masks(
      masks: TensorLike,
      originalSizes: Array<[number, number]>,
      reshapedInputSizes: Array<[number, number]>,
    ): Promise<TensorLike[]>;
  };
}

export interface PromptSegmentationProgress {
  phase: 'MODEL' | 'EMBEDDING' | 'SEGMENTING';
  progress?: number;
}

export interface PromptSegmentationSession {
  segment(box: CameraRoi, point: { x: number; y: number }): Promise<CameraRouteHold>;
}

let runtimePromise: Promise<SamRuntime> | null = null;

export async function preparePromptSegmentation(
  image: HTMLImageElement,
  onProgress?: (progress: PromptSegmentationProgress) => void,
): Promise<PromptSegmentationSession> {
  onProgress?.({ phase: 'MODEL' });
  const runtime = await loadRuntime(onProgress);
  const canvas = imageCanvas(image);
  const imageData = canvas
    .getContext('2d', { willReadFrequently: true })!
    .getImageData(0, 0, canvas.width, canvas.height);
  const rawImage = runtime.RawImage.fromCanvas(canvas);
  const baseInputs = await runtime.processor(rawImage);
  onProgress?.({ phase: 'EMBEDDING' });
  const embeddings = await runtime.model.get_image_embeddings({
    pixel_values: baseInputs.pixel_values,
  });

  return {
    async segment(box, point) {
      onProgress?.({ phase: 'SEGMENTING' });
      const pixelBox = [
        box.x1 * canvas.width,
        box.y1 * canvas.height,
        box.x2 * canvas.width,
        box.y2 * canvas.height,
      ];
      const pixelPoint = [point.x * canvas.width, point.y * canvas.height];
      const promptInputs = await runtime.processor(rawImage, {
        input_boxes: [[pixelBox]],
        input_points: [[[pixelPoint]]],
        input_labels: [[1]],
      });
      const outputs = await runtime.model({
        ...embeddings,
        input_boxes: promptInputs.input_boxes,
        input_points: promptInputs.input_points,
        input_labels: promptInputs.input_labels,
      });
      const masks = await runtime.processor.post_process_masks(
        outputs.pred_masks,
        baseInputs.original_sizes,
        baseInputs.reshaped_input_sizes,
      );
      const pixelsPerMask = canvas.width * canvas.height;
      const maskData = masks[0]?.data;
      if (!maskData || maskData.length < pixelsPerMask) {
        throw new Error('SAM 没有返回有效岩点轮廓');
      }
      const maskCount = Math.max(1, Math.floor(maskData.length / pixelsPerMask));
      const choices: Array<{ component: number[]; score: number; confidence: number }> = [];
      for (let maskIndex = 0; maskIndex < maskCount; maskIndex += 1) {
        const mask = new Uint8Array(pixelsPerMask);
        const offset = maskIndex * pixelsPerMask;
        for (let index = 0; index < pixelsPerMask; index += 1) {
          // post_process_masks normally returns uint8 booleans. The explicit
          // comparison also handles raw float logits if a future runtime does not.
          mask[index] = (maskData[offset + index] ?? Number.NEGATIVE_INFINITY) > 0 ? 1 : 0;
        }
        try {
          const component = clickedComponent(mask, canvas.width, canvas.height, box, point);
          const confidence = Number(outputs.iou_scores.data[maskIndex] ?? 0.75);
          choices.push({
            component,
            confidence,
            score: promptMaskScore(component, canvas.width, canvas.height, box, confidence),
          });
        } catch {
          // SAM returns three alternatives; unusable alternatives are expected.
        }
      }
      const best = choices.sort((left, right) => right.score - left.score)[0];
      if (!best) throw new Error('SAM 没有返回点击位置附近的有效岩点轮廓');
      const refined = refineImplausibleMask(best.component, imageData, box, point);
      return holdFromPixels(refined, imageData, best.confidence, MODEL_VERSION);
    },
  };
}

export function segmentHoldLocally(
  image: HTMLImageElement,
  box: CameraRoi,
  point: { x: number; y: number },
) {
  const canvas = imageCanvas(image);
  const context = canvas.getContext('2d', { willReadFrequently: true })!;
  const imageData = context.getImageData(0, 0, canvas.width, canvas.height);
  const component = localColorComponent(imageData, box, point);
  return holdFromPixels(component, imageData, 0.45, 'local-box-color-v1');
}

async function loadRuntime(onProgress?: (progress: PromptSegmentationProgress) => void) {
  runtimePromise ??= (async () => {
    const transformers = await import('@huggingface/transformers');
    const progressCallback: ProgressCallback = (event) => {
      onProgress?.({
        phase: 'MODEL',
        progress: 'progress' in event ? event.progress : undefined,
      });
    };
    const [model, processor] = await Promise.all([
      transformers.SamModel.from_pretrained(MODEL_ID, {
        dtype: 'q8',
        progress_callback: progressCallback,
      }),
      transformers.AutoProcessor.from_pretrained(MODEL_ID, {
        progress_callback: progressCallback,
      }),
    ]);
    return {
      RawImage: transformers.RawImage,
      model,
      processor,
    } as unknown as SamRuntime;
  })();
  try {
    return await runtimePromise;
  } catch (error) {
    runtimePromise = null;
    throw error;
  }
}

function imageCanvas(image: HTMLImageElement) {
  const canvas = document.createElement('canvas');
  canvas.width = image.naturalWidth;
  canvas.height = image.naturalHeight;
  const context = canvas.getContext('2d', { willReadFrequently: true });
  if (!context) throw new Error('浏览器无法读取摄像头画面');
  context.drawImage(image, 0, 0);
  return canvas;
}

function clickedComponent(
  mask: Uint8Array,
  width: number,
  height: number,
  box: CameraRoi,
  point: { x: number; y: number },
) {
  const padding = Math.max(3, Math.round(Math.min(width, height) * 0.004));
  const left = clampInteger(Math.floor(box.x1 * width) - padding, 0, width - 1);
  const top = clampInteger(Math.floor(box.y1 * height) - padding, 0, height - 1);
  const right = clampInteger(Math.ceil(box.x2 * width) + padding, left + 1, width);
  const bottom = clampInteger(Math.ceil(box.y2 * height) + padding, top + 1, height);
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      if (x < left || x >= right || y < top || y >= bottom) mask[y * width + x] = 0;
    }
  }
  const seed = nearestForeground(
    mask,
    width,
    height,
    clampInteger(Math.round(point.x * width), left, right - 1),
    clampInteger(Math.round(point.y * height), top, bottom - 1),
    Math.max(6, Math.round(Math.max(right - left, bottom - top) * 0.18)),
  );
  if (seed < 0) throw new Error('点击位置附近没有找到岩点，请缩小框选范围后重试');
  const visited = new Uint8Array(mask.length);
  const queue = new Int32Array(mask.length);
  const pixels: number[] = [];
  let head = 0;
  let tail = 1;
  queue[0] = seed;
  visited[seed] = 1;
  while (head < tail) {
    const current = queue[head++]!;
    pixels.push(current);
    const x = current % width;
    const y = Math.floor(current / width);
    for (const next of [current - 1, current + 1, current - width, current + width]) {
      if (next < 0 || next >= mask.length || visited[next] || !mask[next]) continue;
      const nextX = next % width;
      const nextY = Math.floor(next / width);
      if (Math.abs(nextX - x) + Math.abs(nextY - y) !== 1) continue;
      visited[next] = 1;
      queue[tail++] = next;
    }
  }
  if (pixels.length < 24) throw new Error('分割轮廓过小，请重新框住完整岩点');
  return pixels;
}

function nearestForeground(
  mask: Uint8Array,
  width: number,
  height: number,
  centerX: number,
  centerY: number,
  maximumRadius: number,
) {
  const center = centerY * width + centerX;
  if (mask[center]) return center;
  for (let radius = 1; radius <= maximumRadius; radius += 1) {
    for (
      let y = Math.max(0, centerY - radius);
      y <= Math.min(height - 1, centerY + radius);
      y += 1
    ) {
      for (const x of [centerX - radius, centerX + radius]) {
        if (x >= 0 && x < width && mask[y * width + x]) return y * width + x;
      }
    }
    for (
      let x = Math.max(0, centerX - radius);
      x <= Math.min(width - 1, centerX + radius);
      x += 1
    ) {
      for (const y of [centerY - radius, centerY + radius]) {
        if (y >= 0 && y < height && mask[y * width + x]) return y * width + x;
      }
    }
  }
  return -1;
}

function holdFromPixels(
  pixels: number[],
  image: ImageData,
  confidence: number,
  modelVersion: string,
): CameraRouteHold {
  let minX = image.width;
  let minY = image.height;
  let maxX = 0;
  let maxY = 0;
  let red = 0;
  let green = 0;
  let blue = 0;
  for (const pixel of pixels) {
    const x = pixel % image.width;
    const y = Math.floor(pixel / image.width);
    minX = Math.min(minX, x);
    minY = Math.min(minY, y);
    maxX = Math.max(maxX, x);
    maxY = Math.max(maxY, y);
    const offset = pixel * 4;
    red += image.data[offset]!;
    green += image.data[offset + 1]!;
    blue += image.data[offset + 2]!;
  }
  const polygon = componentPolygon(pixels, image.width, image.height, minX, minY, maxX, maxY);
  if (polygon.length < 3) throw new Error('无法生成稳定岩点轮廓');
  const count = pixels.length;
  const average = [red / count, green / count, blue / count].map((value) => Math.round(value));
  return {
    id: `prompt-${Date.now()}-${Math.round((minX + maxX) / 2)}-${Math.round((minY + maxY) / 2)}`,
    x: (minX + maxX + 1) / 2 / image.width,
    y: (minY + maxY + 1) / 2 / image.height,
    width: Math.max(0.002, (maxX - minX + 1) / image.width),
    height: Math.max(0.002, (maxY - minY + 1) / image.height),
    polygon,
    colorHex: rgbHex(average[0]!, average[1]!, average[2]!),
    colorCluster: 'prompt',
    confidence: Math.max(0, Math.min(1, confidence)),
    source: 'PROMPT_SEGMENTATION',
    modelVersion,
  };
}

function averagePatch(image: ImageData, centerX: number, centerY: number, radius: number) {
  const sum = [0, 0, 0];
  let count = 0;
  for (
    let y = Math.max(0, centerY - radius);
    y <= Math.min(image.height - 1, centerY + radius);
    y += 1
  ) {
    for (
      let x = Math.max(0, centerX - radius);
      x <= Math.min(image.width - 1, centerX + radius);
      x += 1
    ) {
      const offset = (y * image.width + x) * 4;
      sum[0] += image.data[offset]!;
      sum[1] += image.data[offset + 1]!;
      sum[2] += image.data[offset + 2]!;
      count += 1;
    }
  }
  return sum.map((value) => value / Math.max(1, count));
}

function promptMaskScore(
  component: number[],
  width: number,
  height: number,
  box: CameraRoi,
  confidence: number,
) {
  const left = clampInteger(Math.floor(box.x1 * width), 0, width - 1);
  const top = clampInteger(Math.floor(box.y1 * height), 0, height - 1);
  const right = clampInteger(Math.ceil(box.x2 * width), left + 1, width);
  const bottom = clampInteger(Math.ceil(box.y2 * height), top + 1, height);
  const boxArea = Math.max(1, (right - left) * (bottom - top));
  const fillRatio = component.length / boxArea;
  let touchedSides = 0;
  for (const side of [
    (pixel: number) => pixel % width <= left + 1,
    (pixel: number) => pixel % width >= right - 2,
    (pixel: number) => Math.floor(pixel / width) <= top + 1,
    (pixel: number) => Math.floor(pixel / width) >= bottom - 2,
  ]) {
    if (component.some(side)) touchedSides += 1;
  }
  const filledBoxPenalty = Math.max(0, fillRatio - 0.82) * 4;
  return confidence - filledBoxPenalty - touchedSides * 0.035;
}

function refineImplausibleMask(
  component: number[],
  image: ImageData,
  box: CameraRoi,
  point: { x: number; y: number },
) {
  const boxArea = Math.max(
    1,
    Math.ceil((box.x2 - box.x1) * image.width) * Math.ceil((box.y2 - box.y1) * image.height),
  );
  if (component.length / boxArea < 0.82) return component;
  try {
    const local = localColorComponent(image, box, point);
    return local.length >= 24 && local.length < component.length * 0.92 ? local : component;
  } catch {
    return component;
  }
}

function localColorComponent(image: ImageData, box: CameraRoi, point: { x: number; y: number }) {
  const seedX = clampInteger(Math.round(point.x * image.width), 0, image.width - 1);
  const seedY = clampInteger(Math.round(point.y * image.height), 0, image.height - 1);
  const seed = averagePatch(image, seedX, seedY, 2);
  const mask = new Uint8Array(image.width * image.height);
  const left = clampInteger(Math.floor(box.x1 * image.width), 0, image.width - 1);
  const top = clampInteger(Math.floor(box.y1 * image.height), 0, image.height - 1);
  const right = clampInteger(Math.ceil(box.x2 * image.width), left + 1, image.width);
  const bottom = clampInteger(Math.ceil(box.y2 * image.height), top + 1, image.height);
  const background = averageBoxBorder(image, left, top, right, bottom);
  const backgroundDistance = rgbDistance(seed, background);
  const threshold = Math.max(34, Math.min(82, backgroundDistance * 0.62));
  for (let y = top; y < bottom; y += 1) {
    for (let x = left; x < right; x += 1) {
      const offset = (y * image.width + x) * 4;
      if (
        rgbDistance(seed, [
          image.data[offset]!,
          image.data[offset + 1]!,
          image.data[offset + 2]!,
        ]) <= threshold
      ) {
        mask[y * image.width + x] = 1;
      }
    }
  }
  return clickedComponent(mask, image.width, image.height, box, point);
}

function averageBoxBorder(
  image: ImageData,
  left: number,
  top: number,
  right: number,
  bottom: number,
) {
  const sum = [0, 0, 0];
  let count = 0;
  const add = (x: number, y: number) => {
    const offset = (y * image.width + x) * 4;
    sum[0] += image.data[offset]!;
    sum[1] += image.data[offset + 1]!;
    sum[2] += image.data[offset + 2]!;
    count += 1;
  };
  for (let x = left; x < right; x += 2) {
    add(x, top);
    add(x, bottom - 1);
  }
  for (let y = top + 1; y < bottom - 1; y += 2) {
    add(left, y);
    add(right - 1, y);
  }
  return sum.map((value) => value / Math.max(1, count));
}

function rgbDistance(first: number[], second: number[]) {
  return Math.sqrt(
    (first[0]! - second[0]!) ** 2 + (first[1]! - second[1]!) ** 2 + (first[2]! - second[2]!) ** 2,
  );
}

function rgbHex(red: number, green: number, blue: number) {
  return `#${[red, green, blue]
    .map((value) => clampInteger(value, 0, 255).toString(16).padStart(2, '0'))
    .join('')}`.toUpperCase();
}

function clampInteger(value: number, minimum: number, maximum: number) {
  return Math.max(minimum, Math.min(maximum, Math.round(value)));
}
