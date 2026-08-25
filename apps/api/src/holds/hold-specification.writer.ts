import { Injectable } from '@nestjs/common';
import {
  HoldIdentitySource,
  type HoldCategory,
  type HoldGripType,
  type Prisma,
} from '@prisma/client';
import type { CurrentSession } from '../auth/session.service';
import type { AddSpecificationInput } from './hold.dto';
import { buildProductKey, createInternalProductCode } from './hold-specification-key';

@Injectable()
export class HoldSpecificationWriter {
  async create(
    transaction: Prisma.TransactionClient,
    session: CurrentSession,
    category: Pick<HoldCategory, 'id' | 'gripType'>,
    input: AddSpecificationInput,
    identity?: ScanIdentity,
  ) {
    const model = await this.findOrCreateProduct(transaction, session, category, input, identity);
    const variant = await transaction.holdVariant.create({
      data: {
        holdModelId: model.id,
        color: input.color,
        activeColor: input.color,
        sku: input.sku,
        inventory: { create: { verificationStatus: 'VERIFIED' } },
      },
      include: { inventory: true },
    });
    return { model, variant };
  }

  async resolveProductForUpdate(
    transaction: Prisma.TransactionClient,
    session: CurrentSession,
    source: ProductSource,
    input: AddSpecificationInput,
  ) {
    const productKey =
      source.identitySource === HoldIdentitySource.SCAN
        ? source.productKey
        : buildProductKey(input);
    if (productKey === source.productKey) {
      return transaction.holdModel.update({
        where: { id: source.id },
        data: productFields(productKey, input),
      });
    }
    const existing = await transaction.holdModel.findUnique({
      where: { categoryId_productKey: { categoryId: source.categoryId, productKey } },
    });
    if (existing) return existing;
    return transaction.holdModel.create({
      data: productData(session, source.categoryId, source.gripType, productKey, input),
    });
  }

  async deleteEmptyProduct(
    transaction: Prisma.TransactionClient,
    productModelId: string,
    retainedModelId?: string,
  ): Promise<void> {
    if (productModelId === retainedModelId) return;
    const count = await transaction.holdVariant.count({ where: { holdModelId: productModelId } });
    if (!count) await transaction.holdModel.delete({ where: { id: productModelId } });
  }

  private async findOrCreateProduct(
    transaction: Prisma.TransactionClient,
    session: CurrentSession,
    category: Pick<HoldCategory, 'id' | 'gripType'>,
    input: AddSpecificationInput,
    identity?: ScanIdentity,
  ) {
    const productKey = identity?.productKey ?? buildProductKey(input);
    const existing = await transaction.holdModel.findUnique({
      where: { categoryId_productKey: { categoryId: category.id, productKey } },
    });
    if (existing) return existing;
    return transaction.holdModel.create({
      data: productData(session, category.id, category.gripType, productKey, input, identity),
    });
  }
}

interface ProductSource {
  id: string;
  categoryId: string;
  gripType: HoldGripType;
  productKey: string;
  identitySource: HoldIdentitySource;
}

export interface ScanIdentity {
  productKey: string;
  fingerprint: string;
}

function productData(
  session: CurrentSession,
  categoryId: string,
  gripType: HoldGripType,
  productKey: string,
  input: AddSpecificationInput,
  identity?: ScanIdentity,
) {
  return {
    ...productFields(productKey, input),
    categoryId,
    code: createInternalProductCode(),
    gripType,
    organizationId: session.organization.id,
    createdByAccountId: session.account.id,
    identitySource: identity ? HoldIdentitySource.SCAN : HoldIdentitySource.MANUAL,
    scanFingerprint: identity?.fingerprint,
  };
}

function productFields(productKey: string, input: AddSpecificationInput) {
  return {
    productKey,
    name: input.productName,
    brand: input.manufacturer,
    style: input.style,
    sizeClass: input.sizeClass,
    widthMm: input.widthMm,
    heightMm: input.heightMm,
    depthMm: input.depthMm,
    mountingType: input.mountingType,
  };
}
