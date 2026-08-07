import { randomUUID } from 'node:crypto';
import type { AddSpecificationInput } from './hold.dto';

type ProductIdentity = Pick<
  AddSpecificationInput,
  'productName' | 'manufacturer' | 'sizeClass' | 'mountingType' | 'widthMm' | 'heightMm' | 'depthMm'
>;

type ColorIdentity = Pick<AddSpecificationInput, 'colorName' | 'colorHex'>;

export function buildProductKey(input: ProductIdentity): string {
  return [
    input.manufacturer,
    input.productName,
    input.sizeClass,
    input.mountingType,
    input.widthMm,
    input.heightMm,
    input.depthMm,
  ]
    .map(normalizeKeyPart)
    .join('|');
}

export function buildColorKey(input: ColorIdentity): string {
  return [input.colorName, input.colorHex].map(normalizeKeyPart).join('|');
}

export function createInternalProductCode(): string {
  return `SPEC-${randomUUID().replaceAll('-', '').slice(0, 12).toUpperCase()}`;
}

function normalizeKeyPart(value: string | number | null | undefined): string {
  return String(value ?? '')
    .trim()
    .replaceAll(/\s+/g, ' ')
    .toLocaleLowerCase('zh-CN');
}
