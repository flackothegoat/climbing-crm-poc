import { ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import {
  HoldAssetKind,
  HoldAssetStatus,
  HoldInitializationStatus,
  HoldScanMode,
  HoldScanStatus,
  HoldStatus,
  type HoldAsset,
  type Prisma,
} from '@prisma/client';
import type { CurrentSession } from '../auth/session.service';
import { AuditService } from '../common/audit.service';
import { isPrismaError } from '../database/prisma-errors';
import { PrismaService } from '../database/prisma.service';
import { AccessControlService, Capability } from '../security/access-control.service';
import type { CreateScanInput, FinalizeScanInput } from './hold.dto';
import { HoldAssetService, toAsset } from './hold-asset.service';
import { HoldInitializationService } from './hold-initialization.service';
import { buildProductKey } from './hold-specification-key';
import { HoldSpecificationWriter } from './hold-specification.writer';
import { lockHoldOrganization } from './hold-transaction-lock';

@Injectable()
export class HoldScanService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly access: AccessControlService,
    private readonly assets: HoldAssetService,
    private readonly initialization: HoldInitializationService,
    private readonly specificationWriter: HoldSpecificationWriter,
  ) {}

  async create(session: CurrentSession, input: CreateScanInput) {
    this.access.assert(session, Capability.HOLD_WRITE);
    return this.prisma.$transaction(async (transaction) => {
      const context = await this.resolveCreateContext(session.organization.id, input, transaction);
      const scan = await transaction.holdScan.create({
        data: {
          organizationId: session.organization.id,
          categoryId: context.categoryId,
          specificationId: context.specificationId,
          initializationBatchId: input.initializationBatchId,
          mode: input.mode,
          createdByAccountId: session.account.id,
        },
        include: { assets: true },
      });
      await this.recordAudit(
        session,
        scan.id,
        'hold.capture.created',
        { mode: input.mode },
        transaction,
      );
      return toScan(scan);
    });
  }

  async finalize(session: CurrentSession, scanId: string, input: FinalizeScanInput) {
    this.access.assert(session, Capability.HOLD_RECEIVE);
    try {
      const result = await this.prisma.$transaction(async (transaction) => {
        await lockHoldOrganization(transaction, session.organization.id);
        const scan = await findDraftScan(transaction, session.organization.id, scanId);
        assertNewSpecificationScan(scan);
        const modelAsset = requireModelAsset(scan.assets);
        const { model, variant } = await this.specificationWriter.create(
          transaction,
          session,
          scan.category,
          input.specification,
          scanIdentity(modelAsset.checksumSha256, input.specification),
        );
        await this.initializeWhenRequested(transaction, session, scan, variant.id, input);
        await completeScanRecords(transaction, scan.id, variant.id);
        const result = { specificationId: variant.id, productModelId: model.id };
        await this.recordAudit(
          session,
          scanId,
          'hold.capture.specification.created',
          result,
          transaction,
        );
        return result;
      });
      return result;
    } catch (error) {
      if (isPrismaError(error, 'P2002')) {
        throw new ConflictException('该岩点档案已经存在，请进入现有档案补充模型或登记库存');
      }
      throw error;
    }
  }

  async completeAttachment(session: CurrentSession, scanId: string): Promise<void> {
    this.access.assert(session, Capability.HOLD_WRITE);
    await this.prisma.$transaction(async (transaction) => {
      await lockHoldOrganization(transaction, session.organization.id);
      const scan = await findDraftScan(transaction, session.organization.id, scanId);
      assertAttachmentScan(scan);
      requireModelAsset(scan.assets);
      await assertActiveSpecification(transaction, session.organization.id, scan.specificationId);
      await assertSpecificationHasNoModel(transaction, scan.specificationId);
      await completeScanRecords(transaction, scan.id, scan.specificationId);
      await this.recordAudit(
        session,
        scanId,
        'hold.capture.model.attached',
        { specificationId: scan.specificationId },
        transaction,
      );
    });
  }

  async cancel(session: CurrentSession, scanId: string): Promise<void> {
    this.access.assert(session, Capability.HOLD_WRITE);
    const assets = await this.prisma.$transaction(async (transaction) => {
      await lockHoldOrganization(transaction, session.organization.id);
      const scan = await transaction.holdScan.findFirst({
        where: {
          id: scanId,
          organizationId: session.organization.id,
          status: HoldScanStatus.DRAFT,
        },
        include: { assets: true },
      });
      if (!scan) throw new NotFoundException('可取消的采集草稿不存在');
      await transaction.holdAsset.updateMany({
        where: { scanId, status: HoldAssetStatus.READY },
        data: { status: HoldAssetStatus.DELETED },
      });
      await transaction.holdScan.update({
        where: { id: scanId },
        data: { status: HoldScanStatus.CANCELLED },
      });
      await this.recordAudit(session, scanId, 'hold.capture.cancelled', {}, transaction);
      return scan.assets;
    });
    await this.assets.removeObjectsQuietly(assets);
  }

  private async resolveCreateContext(
    organizationId: string,
    input: CreateScanInput,
    client: Prisma.TransactionClient = this.prisma,
  ) {
    if (input.mode === HoldScanMode.ENRICH_SPECIFICATION) {
      return this.findAttachmentTarget(organizationId, input.specificationId!, client);
    }
    await this.assertActiveCategory(organizationId, input.categoryId!, client);
    if (input.initializationBatchId) {
      await this.assertActiveBatch(organizationId, input.initializationBatchId, client);
    }
    return { categoryId: input.categoryId!, specificationId: undefined };
  }

  private async findAttachmentTarget(
    organizationId: string,
    specificationId: string,
    client: Prisma.TransactionClient = this.prisma,
  ) {
    const target = await client.holdVariant.findFirst({
      where: {
        id: specificationId,
        status: HoldStatus.ACTIVE,
        deletedAt: null,
        holdModel: { organizationId, category: { status: HoldStatus.ACTIVE } },
      },
      select: {
        id: true,
        holdModel: { select: { categoryId: true } },
        assets: { where: { kind: HoldAssetKind.MODEL_3D }, select: { id: true } },
      },
    });
    if (!target) throw new NotFoundException('可补充三维模型的岩点档案不存在');
    if (target.assets.length) throw new ConflictException('该岩点档案已经有主三维模型');
    return { categoryId: target.holdModel.categoryId, specificationId: target.id };
  }

  private async assertActiveCategory(
    organizationId: string,
    categoryId: string,
    client: Prisma.TransactionClient = this.prisma,
  ): Promise<void> {
    const category = await client.holdCategory.findFirst({
      where: { id: categoryId, organizationId, status: HoldStatus.ACTIVE },
      select: { id: true },
    });
    if (!category) throw new NotFoundException('可用岩点用途分类不存在');
  }

  private async assertActiveBatch(
    organizationId: string,
    batchId: string,
    client: Prisma.TransactionClient = this.prisma,
  ): Promise<void> {
    const batch = await client.holdInitializationBatch.findFirst({
      where: { id: batchId, organizationId, status: HoldInitializationStatus.ACTIVE },
      select: { id: true },
    });
    if (!batch) throw new NotFoundException('进行中的初始化批次不存在');
  }

  private async initializeWhenRequested(
    transaction: Prisma.TransactionClient,
    session: CurrentSession,
    scan: DraftScan,
    specificationId: string,
    input: FinalizeScanInput,
  ): Promise<void> {
    if (!scan.initializationBatchId && !input.inventory) return;
    if (!scan.initializationBatchId || !input.inventory) {
      throw new ConflictException('初始化批次和现场实数必须同时提供');
    }
    await this.initialization.addEntry(
      transaction,
      session,
      scan.initializationBatchId,
      specificationId,
      input.inventory,
      scan.id,
    );
  }

  private recordAudit(
    session: CurrentSession,
    scanId: string,
    type: string,
    metadata: Record<string, unknown> = {},
    client?: Prisma.TransactionClient,
  ): Promise<unknown> {
    return this.audit.record(
      {
        organizationId: session.organization.id,
        actorAccountId: session.account.id,
        type,
        outcome: 'SUCCESS',
        metadata: { scanId, ...metadata },
      },
      client,
    );
  }
}

async function findDraftScan(
  transaction: Prisma.TransactionClient,
  organizationId: string,
  scanId: string,
) {
  const scan = await transaction.holdScan.findFirst({
    where: { id: scanId, organizationId, status: HoldScanStatus.DRAFT },
    include: { category: true, assets: true },
  });
  if (!scan) throw new NotFoundException('可完成的采集草稿不存在');
  return scan;
}

type DraftScan = NonNullable<Awaited<ReturnType<typeof findDraftScan>>>;

function assertNewSpecificationScan(scan: DraftScan): void {
  if (scan.mode !== HoldScanMode.CREATE_SPECIFICATION) {
    throw new ConflictException('该采集草稿用于补充已有档案，不能创建新档案');
  }
}

function assertAttachmentScan(
  scan: DraftScan,
): asserts scan is DraftScan & { specificationId: string } {
  if (scan.mode !== HoldScanMode.ENRICH_SPECIFICATION || !scan.specificationId) {
    throw new ConflictException('该采集草稿不能关联已有岩点档案');
  }
}

function requireModelAsset(assets: HoldAsset[]): HoldAsset {
  const model = assets.find(
    (asset) => asset.kind === HoldAssetKind.MODEL_3D && asset.status === HoldAssetStatus.READY,
  );
  if (!model) throw new ConflictException('请先上传并确认主 3D 模型');
  return model;
}

async function assertSpecificationHasNoModel(
  transaction: Prisma.TransactionClient,
  specificationId: string,
): Promise<void> {
  const count = await transaction.holdAsset.count({
    where: { specificationId, kind: HoldAssetKind.MODEL_3D, status: HoldAssetStatus.READY },
  });
  if (count) throw new ConflictException('该岩点档案已经有主三维模型');
}

async function assertActiveSpecification(
  transaction: Prisma.TransactionClient,
  organizationId: string,
  specificationId: string,
): Promise<void> {
  const specification = await transaction.holdVariant.findFirst({
    where: {
      id: specificationId,
      status: HoldStatus.ACTIVE,
      deletedAt: null,
      holdModel: { organizationId, category: { status: HoldStatus.ACTIVE } },
    },
    select: { id: true },
  });
  if (!specification) throw new ConflictException('目标岩点档案已停用或删除');
}

async function completeScanRecords(
  transaction: Prisma.TransactionClient,
  scanId: string,
  specificationId: string,
): Promise<void> {
  await transaction.holdAsset.updateMany({ where: { scanId }, data: { specificationId } });
  await transaction.holdScan.update({
    where: { id: scanId },
    data: { specificationId, status: HoldScanStatus.COMPLETED, completedAt: new Date() },
  });
}

function scanIdentity(checksum: string, input: FinalizeScanInput['specification']) {
  return { productKey: buildProductKey(input), fingerprint: checksum };
}

function toScan(scan: {
  id: string;
  categoryId: string;
  specificationId: string | null;
  initializationBatchId: string | null;
  mode: HoldScanMode;
  status: HoldScanStatus;
  assets: HoldAsset[];
}) {
  return {
    id: scan.id,
    categoryId: scan.categoryId,
    specificationId: scan.specificationId,
    initializationBatchId: scan.initializationBatchId,
    mode: scan.mode,
    status: scan.status,
    assets: scan.assets.map(toAsset),
  };
}
