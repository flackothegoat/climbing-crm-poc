import { z } from 'zod';

export function normalizeRfidIdentifier(value: string): string {
  return value.replace(/[\s:-]/g, '').toUpperCase();
}

export const rfidIdentifierSchema = z
  .string()
  .trim()
  .transform(normalizeRfidIdentifier)
  .refine(
    (value) => /^[0-9A-F]{8,128}$/.test(value) && value.length % 2 === 0,
    'RFID 标识必须是 8 至 128 位偶数长度十六进制字符',
  );
