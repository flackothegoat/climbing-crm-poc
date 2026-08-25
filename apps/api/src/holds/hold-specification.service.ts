import { ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { HoldStatus, Prisma } from '@prisma/client';
import type { CurrentSession } from '../auth/session.service';
import { AuditService } from '../common/audit.service';
import { isPrismaError } from '../database/prisma-errors';
import { PrismaService } from '../database/prisma.service';
import { AccessControlService, Capability } from '../security/access-control.service';
import type {
  AddSpecificationInput,
  CreateHoldRecordInput,
  UpdateSpecificationInput,
} from './hold.dto';
import { HoldInitializationService } from './hold-initialization.service';
import { inventoryTotal, toSpecification } from './hold.mapper';
import { HoldSpecificationWriter } from './hold-specification.writer';
import { lockHoldOrganization } from './hold-transaction-lock';
import { UNKNOWN_HOLD_MANUFACTURER } from './hold-domain.constants';

@Injectable()
export class HoldSpecificationService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly access: AccessControlService,
    private readonly writer: HoldSpecificationWriter,
    private readonly initialization: HoldInitializationService,
  ) {}

  async add(session: CurrentSession, categoryId: string, input: AddSpecificationInput) {
    this.access.assert(session, Capability.HOLD_WRITE);
    try {
      const specification = await this.prisma.$transaction(async (transaction) => {
        await lockHoldOrganization(transaction, session.organization.id);
        const category = await this.findActiveCategory(
          session.organization.id,
          categoryId,
          transaction,
        );
        const { model, variant } = await this.writer.create(transaction, session, category, input);
        const result = toSpecification(model, variant);
        await this.recordAudit(
          session,
          categoryId,
          result.id,
          'hold.specification.created',
          transaction,
        );
        return result;
      });
      return specification;
    } catch (error) {
      if (isPrismaError(error, 'P2002')) {
        throw new ConflictException('完全相同的岩点规格已经存在，请直接进入该规格入库');
      }
      throw error;
    }
  }

  async addRecord(session: CurrentSession, categoryId: string, input: CreateHoldRecordInput) {
    this.access.assert(session, Capability.HOLD_WRITE);
    try {
      const specification = await this.prisma.$transaction(async (transaction) => {
        await lockHoldOrganization(transaction, session.organization.id);
        const category = await this.findActiveCategory(
          session.organization.id,
          categoryId,
          transaction,
        );
        const { model, variant } = await this.writer.create(
          transaction,
          session,
          category,
          input.specification,
        );
        if (input.initialization) {
          await this.initialization.addEntry(
            transaction,
            session,
            input.initialization.batchId,
            variant.id,
            input.initialization,
          );
        }
        const result = toSpecification(model, variant);
        await this.recordAudit(session, categoryId, result.id, 'hold.record.created', transaction);
        return result;
      });
      return specification;
    } catch (error) {
      if (isPrismaError(error, 'P2002')) {
        throw new ConflictException('完全相同的岩点档案已经存在，请直接使用现有档案');
      }
      throw error;
    }
  }

  async update(session: CurrentSession, specificationId: string, input: UpdateSpecificationInput) {
    this.access.assert(session, Capability.HOLD_WRITE);
    try {
      const updated = await this.prisma.$transaction(async (transaction) => {
        await lockHoldOrganization(transaction, session.organization.id);
        const source = await this.findSpecification(
          session.organization.id,
          specificationId,
          transaction,
        );
        this.assertEditable(source);
        const merged = mergeSpecification(source, input);
        const targetModel = await this.writer.resolveProductForUpdate(
          transaction,
          session,
          source.holdModel,
          merged,
        );
        const variant = await transaction.holdVariant.update({
          where: { id: specificationId },
          data: {
            holdModelId: targetModel.id,
            color: merged.color,
            activeColor: merged.color,
            sku: merged.sku,
          },
          include: { inventory: true },
        });
        await this.writer.deleteEmptyProduct(transaction, source.holdModelId, targetModel.id);
        const result = toSpecification(targetModel, variant);
        await this.recordAudit(
          session,
          source.holdModel.categoryId,
          specificationId,
          'hold.specification.updated',
          transaction,
        );
        return result;
      });
      return updated;
    } catch (error) {
      if (isPrismaError(error, 'P2002')) throw new ConflictException('完全相同的岩点规格已经存在');
      throw error;
    }
  }

  async stop(session: CurrentSession, specificationId: string): Promise<void> {
    this.access.assert(session, Capability.HOLD_ARCHIVE);
    await this.prisma.$transaction(async (transaction) => {
      await lockHoldOrganization(transaction, session.organization.id);
      const specification = await this.findSpecification(
        session.organization.id,
        specificationId,
        transaction,
      );
      if (specification.status === HoldStatus.ARCHIVED) {
        throw new ConflictException('该规格已经停用');
      }
      if (inventoryTotal(specification.inventory) > 0) {
        throw new ConflictException('仍有库存的规格不能停用');
      }
      await transaction.holdVariant.update({
        where: { id: specificationId },
        data: { status: HoldStatus.ARCHIVED },
      });
      await this.recordAudit(
        session,
        specification.holdModel.categoryId,
        specificationId,
        'hold.specification.stopped',
        transaction,
      );
    });
  }

  async restore(session: CurrentSession, specificationId: string): Promise<void> {
    this.access.assert(session, Capability.HOLD_ARCHIVE);
    await this.prisma.$transaction(async (transaction) => {
      await lockHoldOrganization(transaction, session.organization.id);
      const specification = await this.findSpecification(
        session.organization.id,
        specificationId,
        transaction,
      );
      if (specification.holdModel.category.status !== HoldStatus.ACTIVE) {
        throw new ConflictException('请先恢复所属用途分类');
      }
      if (specification.status === HoldStatus.ACTIVE) {
        throw new ConflictException('该规格已经启用');
      }
      await transaction.holdVariant.update({
        where: { id: specificationId },
        data: { status: HoldStatus.ACTIVE },
      });
      await this.recordAudit(
        session,
        specification.holdModel.categoryId,
        specificationId,
        'hold.specification.restored',
        transaction,
      );
    });
  }

  private async findActiveCategory(
    organizationId: string,
    categoryId: string,
    client: ActiveCategoryClient = this.prisma,
  ) {
    const category = await client.holdCategory.findFirst({
      where: { id: categoryId, organizationId, status: HoldStatus.ACTIVE },
    });
    if (!category) throw new NotFoundException('可用岩点用途分类不存在');
    return category;
  }

  private async findSpecification(
    organizationId: string,
    specificationId: string,
    client: SpecificationClient = this.prisma,
  ) {
    const specification = await client.holdVariant.findFirst({
      where: { id: specificationId, deletedAt: null, holdModel: { organizationId } },
      include: {
        inventory: true,
        holdModel: { include: { category: true, _count: { select: { variants: true } } } },
        _count: {
          select: { movements: true, assets: true, scans: true, initializationEntries: true },
        },
      },
    });
    if (!specification) throw new NotFoundException('岩点规格不存在');
    return specification;
  }

  private assertEditable(specification: SpecificationWithUsage): void {
    if (
      specification.status !== HoldStatus.ACTIVE ||
      specification.holdModel.category.status !== HoldStatus.ACTIVE
    ) {
      throw new ConflictException('停用分类或规格不能继续编辑');
    }
  }

  private recordAudit(
    session: CurrentSession,
    categoryId: string,
    specificationId: string,
    type: string,
    client?: Prisma.TransactionClient,
  ): Promise<unknown> {
    return this.audit.record(
      {
        organizationId: session.organization.id,
        actorAccountId: session.account.id,
        type,
        outcome: 'SUCCESS',
        metadata: { categoryId, specificationId },
      },
      client,
    );
  }
}

type SpecificationWithUsage = Prisma.HoldVariantGetPayload<{
  include: {
    inventory: true;
    holdModel: { include: { category: true; _count: { select: { variants: true } } } };
    _count: {
      select: { movements: true; assets: true; scans: true; initializationEntries: true };
    };
  };
}>;

type SpecificationClient = Pick<PrismaService, 'holdVariant'> | Prisma.TransactionClient;
type ActiveCategoryClient = Pick<PrismaService, 'holdCategory'> | Prisma.TransactionClient;

function mergeSpecification(
  source: SpecificationWithUsage,
  input: UpdateSpecificationInput,
): AddSpecificationInput {
  return {
    productName: input.productName ?? source.holdModel.name,
    manufacturer: input.manufacturer ?? source.holdModel.brand ?? UNKNOWN_HOLD_MANUFACTURER,
    style: input.style === undefined ? source.holdModel.style : input.style,
    sizeClass: input.sizeClass ?? source.holdModel.sizeClass,
    widthMm: input.widthMm === undefined ? source.holdModel.widthMm : input.widthMm,
    heightMm: input.heightMm === undefined ? source.holdModel.heightMm : input.heightMm,
    depthMm: input.depthMm === undefined ? source.holdModel.depthMm : input.depthMm,
    mountingType: input.mountingType ?? source.holdModel.mountingType,
    color: input.color ?? source.color,
    sku: input.sku === undefined ? source.sku : input.sku,
  };
}
