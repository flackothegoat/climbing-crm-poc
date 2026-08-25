import { ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { HoldStatus, InventoryMovementType, Prisma } from '@prisma/client';
import type { CurrentSession } from '../auth/session.service';
import { AuditService } from '../common/audit.service';
import { isPrismaError } from '../database/prisma-errors';
import { PrismaService } from '../database/prisma.service';
import { AccessControlService, Capability } from '../security/access-control.service';
import type { CreateCategoryInput, ListCategoriesInput, UpdateCategoryInput } from './hold.dto';
import { defaultCategoryData } from './hold-category.defaults';
import { inventoryTotal, toCategorySummary } from './hold.mapper';
import { lockHoldOrganization } from './hold-transaction-lock';

@Injectable()
export class HoldCategoryService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly access: AccessControlService,
  ) {}

  async list(session: CurrentSession, input: ListCategoriesInput) {
    this.access.assert(session, Capability.HOLD_READ);
    const where = categoryListFilter(session.organization.id, input);
    const [categories, total] = await this.prisma.$transaction([
      this.prisma.holdCategory.findMany({
        where,
        include: allSpecificationsInclude,
        orderBy: { updatedAt: 'desc' },
        skip: (input.page - 1) * input.pageSize,
        take: input.pageSize,
      }),
      this.prisma.holdCategory.count({ where }),
    ]);
    return {
      items: categories.map(toCategorySummary),
      total,
      page: input.page,
      pageSize: input.pageSize,
    };
  }

  async get(session: CurrentSession, categoryId: string) {
    this.access.assert(session, Capability.HOLD_READ);
    const category = await this.findCategoryWithUsage(session.organization.id, categoryId);
    const movements = await this.findRecentMovements(session.organization.id, categoryId);
    return toCategoryDetail(category, movements);
  }

  async create(session: CurrentSession, input: CreateCategoryInput) {
    this.access.assert(session, Capability.HOLD_WRITE);
    try {
      return await this.prisma.$transaction(async (transaction) => {
        await lockHoldOrganization(transaction, session.organization.id);
        await this.assertCategoryIdentityAvailable(session.organization.id, input, transaction);
        const category = await transaction.holdCategory.create({
          data: {
            ...input,
            organizationId: session.organization.id,
            createdByAccountId: session.account.id,
          },
          include: allSpecificationsInclude,
        });
        await this.recordAudit(
          session,
          category.id,
          'hold.category.created',
          undefined,
          transaction,
        );
        return toCategorySummary(category);
      });
    } catch (error) {
      if (isPrismaError(error, 'P2002')) throw new ConflictException('编号或抓握用途已经存在');
      throw error;
    }
  }

  async ensureDefaults(session: CurrentSession) {
    this.access.assert(session, Capability.HOLD_WRITE);
    return this.prisma.$transaction(async (transaction) => {
      await lockHoldOrganization(transaction, session.organization.id);
      const result = await transaction.holdCategory.createMany({
        data: defaultCategoryData(session.organization.id, session.account.id),
        skipDuplicates: true,
      });
      if (result.count) {
        await this.audit.record(
          {
            organizationId: session.organization.id,
            actorAccountId: session.account.id,
            type: 'hold.category.defaults.created',
            outcome: 'SUCCESS',
            metadata: { count: result.count },
          },
          transaction,
        );
      }
      return { createdCount: result.count };
    });
  }

  async update(session: CurrentSession, categoryId: string, input: UpdateCategoryInput) {
    this.access.assert(session, Capability.HOLD_WRITE);
    return this.prisma.$transaction(async (transaction) => {
      await lockHoldOrganization(transaction, session.organization.id);
      await this.assertActiveCategory(session.organization.id, categoryId, transaction);
      const category = await transaction.holdCategory.update({
        where: { id: categoryId },
        data: input,
      });
      await this.recordAudit(
        session,
        categoryId,
        'hold.category.updated',
        Object.keys(input),
        transaction,
      );
      return category;
    });
  }

  async stop(session: CurrentSession, categoryId: string): Promise<void> {
    this.access.assert(session, Capability.HOLD_ARCHIVE);
    await this.prisma.$transaction(async (transaction) => {
      await lockHoldOrganization(transaction, session.organization.id);
      const category = await this.findCategoryWithUsage(
        session.organization.id,
        categoryId,
        transaction,
      );
      if (category.status === HoldStatus.ARCHIVED) throw new ConflictException('该分类已经停用');
      if (categoryInventoryTotal(category) > 0) {
        throw new ConflictException('仍有库存的分类不能停用');
      }
      await transaction.holdCategory.update({
        where: { id: categoryId },
        data: { status: HoldStatus.ARCHIVED },
      });
      await this.recordAudit(session, categoryId, 'hold.category.stopped', undefined, transaction);
    });
  }

  async restore(session: CurrentSession, categoryId: string): Promise<void> {
    this.access.assert(session, Capability.HOLD_ARCHIVE);
    await this.prisma.$transaction(async (transaction) => {
      await lockHoldOrganization(transaction, session.organization.id);
      const result = await transaction.holdCategory.updateMany({
        where: {
          id: categoryId,
          organizationId: session.organization.id,
          status: HoldStatus.ARCHIVED,
        },
        data: { status: HoldStatus.ACTIVE },
      });
      if (!result.count) throw new NotFoundException('未找到可恢复的停用分类');
      await this.recordAudit(session, categoryId, 'hold.category.restored', undefined, transaction);
    });
  }

  async deleteUnused(session: CurrentSession, categoryId: string): Promise<void> {
    this.access.assert(session, Capability.HOLD_ARCHIVE);
    await this.prisma.$transaction(async (transaction) => {
      await lockHoldOrganization(transaction, session.organization.id);
      const category = await this.findCategoryWithUsage(
        session.organization.id,
        categoryId,
        transaction,
      );
      if (!canDeleteCategory(category)) {
        throw new ConflictException('只有零库存、从未入账且没有扫描记录的分类可以永久删除');
      }
      await transaction.holdInventoryBalance.deleteMany({
        where: { variant: { holdModel: { categoryId } } },
      });
      await transaction.holdVariant.deleteMany({ where: { holdModel: { categoryId } } });
      await transaction.holdModel.deleteMany({ where: { categoryId } });
      await transaction.holdCategory.delete({ where: { id: categoryId } });
      await this.recordAudit(session, categoryId, 'hold.category.deleted', undefined, transaction);
    });
  }

  async assertActiveCategory(
    organizationId: string,
    categoryId: string,
    client: CategoryClient = this.prisma,
  ): Promise<void> {
    const category = await client.holdCategory.findFirst({
      where: { id: categoryId, organizationId },
      select: { status: true },
    });
    if (!category) throw new NotFoundException('岩点用途分类不存在');
    if (category.status !== HoldStatus.ACTIVE) throw new ConflictException('停用分类不能继续编辑');
  }

  private async assertCategoryIdentityAvailable(
    organizationId: string,
    input: CreateCategoryInput,
    client: CategoryClient = this.prisma,
  ): Promise<void> {
    const existing = await client.holdCategory.findFirst({
      where: { organizationId, OR: [{ code: input.code }, { gripType: input.gripType }] },
      select: { code: true, gripType: true, status: true },
    });
    if (!existing) return;
    if (existing.code === input.code && existing.status === HoldStatus.ARCHIVED) {
      throw new ConflictException(
        `编号 ${input.code} 属于已停用分类。请恢复该分类；只有永久删除未使用档案后编号才会释放。`,
      );
    }
    if (existing.code === input.code) throw new ConflictException(`编号 ${input.code} 已被使用`);
    throw new ConflictException('该抓握用途已经有分类，请进入现有分类添加规格');
  }

  private async findCategoryWithUsage(
    organizationId: string,
    categoryId: string,
    client: CategoryClient = this.prisma,
  ) {
    const category = await client.holdCategory.findFirst({
      where: { id: categoryId, organizationId },
      include: {
        _count: { select: { scans: true } },
        models: {
          include: {
            _count: { select: { variants: true } },
            variants: {
              where: { deletedAt: null },
              include: {
                inventory: true,
                assets: {
                  include: { sourceProcessingJob: true },
                  orderBy: { createdAt: 'asc' },
                },
                _count: {
                  select: {
                    movements: true,
                    routeHoldPlacements: true,
                    installations: true,
                    observedWallHolds: true,
                  },
                },
              },
            },
          },
          orderBy: { createdAt: 'asc' },
        },
      },
    });
    if (!category) throw new NotFoundException('岩点用途分类不存在');
    return category;
  }

  private findRecentMovements(organizationId: string, categoryId: string) {
    return this.prisma.holdInventoryMovement.findMany({
      where: { organizationId, variant: { deletedAt: null, holdModel: { categoryId } } },
      include: movementDetailsInclude(organizationId),
      orderBy: { occurredAt: 'desc' },
      take: 30,
    });
  }

  private recordAudit(
    session: CurrentSession,
    categoryId: string,
    type: string,
    changedFields?: string[],
    client?: Prisma.TransactionClient,
  ): Promise<unknown> {
    return this.audit.record(
      {
        organizationId: session.organization.id,
        actorAccountId: session.account.id,
        type,
        outcome: 'SUCCESS',
        metadata: { categoryId, ...(changedFields ? { changedFields } : {}) },
      },
      client,
    );
  }
}

const allSpecificationsInclude = {
  models: {
    include: {
      variants: {
        where: { deletedAt: null },
        include: {
          inventory: true,
          assets: {
            include: { sourceProcessingJob: true },
            orderBy: { createdAt: 'asc' as const },
          },
        },
        orderBy: { createdAt: 'asc' as const },
      },
    },
    orderBy: { createdAt: 'asc' as const },
  },
};

const movementDetailsInclude = (organizationId: string) =>
  ({
    variant: {
      select: {
        color: true,
        holdModel: { select: { name: true } },
      },
    },
    reversedBy: { select: { id: true } },
    actor: {
      select: {
        memberships: { where: { organizationId }, select: { displayName: true }, take: 1 },
      },
    },
  }) as const;

function categoryListFilter(
  organizationId: string,
  input: ListCategoriesInput,
): Prisma.HoldCategoryWhereInput {
  return {
    organizationId,
    ...(input.status === 'ALL' ? {} : { status: input.status }),
    ...(input.gripType ? { gripType: input.gripType } : {}),
    ...(input.search
      ? {
          OR: [
            { code: { contains: input.search, mode: 'insensitive' } },
            { name: { contains: input.search, mode: 'insensitive' } },
            {
              models: {
                some: {
                  name: { contains: input.search, mode: 'insensitive' },
                  variants: { some: { deletedAt: null } },
                },
              },
            },
            {
              models: {
                some: {
                  brand: { contains: input.search, mode: 'insensitive' },
                  variants: { some: { deletedAt: null } },
                },
              },
            },
          ],
        }
      : {}),
  };
}

type CategoryWithUsage = Prisma.HoldCategoryGetPayload<{
  include: {
    _count: { select: { scans: true } };
    models: {
      include: {
        _count: { select: { variants: true } };
        variants: {
          include: {
            inventory: true;
            assets: true;
            _count: {
              select: {
                movements: true;
                routeHoldPlacements: true;
                installations: true;
                observedWallHolds: true;
              };
            };
          };
        };
      };
    };
  };
}>;

type MovementWithDetails = Prisma.HoldInventoryMovementGetPayload<{
  include: ReturnType<typeof movementDetailsInclude>;
}>;

type CategoryClient = Pick<PrismaService, 'holdCategory'> | Prisma.TransactionClient;

function toCategoryDetail(category: CategoryWithUsage, movements: MovementWithDetails[]) {
  const summary = toCategorySummary(category);
  const variants = new Map(
    category.models.flatMap((model) => model.variants.map((variant) => [variant.id, variant])),
  );
  return {
    ...summary,
    lifecycle: categoryLifecycle(category),
    specifications: summary.specifications.map((item) => ({
      ...item,
      lifecycle: specificationLifecycle(item, variants.get(item.id)),
    })),
    movements: movements.map(toMovement),
  };
}

function categoryLifecycle(category: CategoryWithUsage) {
  return {
    canDelete: canDeleteCategory(category),
    canStop: category.status === HoldStatus.ACTIVE && categoryInventoryTotal(category) === 0,
    canRestore: category.status === HoldStatus.ARCHIVED,
  };
}

function specificationLifecycle(
  specification: {
    status: HoldStatus;
    inventory: { totalQuantity: number };
  },
  usage?: CategoryWithUsage['models'][number]['variants'][number],
) {
  return {
    canDelete:
      specification.inventory.totalQuantity === 0 &&
      usage !== undefined &&
      usage._count.movements === 0 &&
      usage._count.routeHoldPlacements === 0 &&
      usage._count.installations === 0 &&
      usage._count.observedWallHolds === 0,
    canStop:
      specification.status === HoldStatus.ACTIVE && specification.inventory.totalQuantity === 0,
    canRestore: specification.status === HoldStatus.ARCHIVED,
  };
}

function canDeleteCategory(category: CategoryWithUsage): boolean {
  return (
    category._count.scans === 0 &&
    category.models.every(
      (model) =>
        model._count.variants === model.variants.length &&
        model.variants.every(
          (variant) =>
            inventoryTotal(variant.inventory) === 0 &&
            variant._count.movements === 0 &&
            variant._count.routeHoldPlacements === 0 &&
            variant._count.installations === 0 &&
            variant._count.observedWallHolds === 0,
        ),
    )
  );
}

function categoryInventoryTotal(category: CategoryWithUsage): number {
  return category.models.reduce(
    (modelTotal, model) =>
      modelTotal +
      model.variants.reduce(
        (variantTotal, item) => variantTotal + inventoryTotal(item.inventory),
        0,
      ),
    0,
  );
}

function toMovement(movement: MovementWithDetails) {
  return {
    id: movement.id,
    type: movement.type,
    bucket: movement.bucket,
    quantityDelta: movement.quantityDelta,
    beforeQuantity: movement.beforeQuantity,
    afterQuantity: movement.afterQuantity,
    note: movement.note,
    occurredAt: movement.occurredAt.toISOString(),
    specification: {
      productName: movement.variant.holdModel.name,
      color: movement.variant.color,
    },
    actorName: movement.actor.memberships[0]?.displayName ?? '岩馆员工',
    reversed: movement.reversedBy !== null,
    reversalOfMovementId: movement.reversalOfMovementId,
    canReverse: movement.type === InventoryMovementType.RECEIPT && movement.reversedBy === null,
  };
}
