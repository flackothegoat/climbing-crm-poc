import { BadRequestException } from '@nestjs/common';
import type { z } from 'zod';

export function parseWithSchema<T>(schema: z.ZodType<T>, input: unknown): T {
  const result = schema.safeParse(input);
  if (result.success) return result.data;
  throw new BadRequestException(result.error.issues[0]?.message ?? '请求参数不符合要求');
}
