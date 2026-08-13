import { Injectable } from '@nestjs/common';
import { HoldAssetKind, HoldAssetStatus, HoldMountingType, HoldStatus } from '@prisma/client';
import type { CurrentSession } from '../auth/session.service';
import { PrismaService } from '../database/prisma.service';
import { AccessControlService, Capability } from '../security/access-control.service';
import type { ListRouteSettingAssetsInput } from './wall-setting-job.dto';

@Injectable()
export class RouteSettingAssetService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly access: AccessControlService,
  ) {}

  async list(session: CurrentSession, input: ListRouteSettingAssetsInput) {
    this.access.assert(session, Capability.ASSET_READ);
    const variants = await this.prisma.holdVariant.findMany({
      where: {
        status: HoldStatus.ACTIVE,
        deletedAt: null,
        holdModel: {
          organizationId: session.organization.id,
          status: HoldStatus.ACTIVE,
          category: { status: HoldStatus.ACTIVE },
        },
        assets: {
          some: { kind: HoldAssetKind.MODEL_3D, status: HoldAssetStatus.READY },
        },
      },
      include: {
        inventory: true,
        holdModel: true,
        assets: {
          where: {
            status: HoldAssetStatus.READY,
            kind: { in: [HoldAssetKind.MODEL_3D, HoldAssetKind.MODEL_PREVIEW] },
          },
          orderBy: { createdAt: 'desc' },
        },
      },
      orderBy: { id: 'asc' },
      take: input.limit + 1,
      ...(input.cursor ? { cursor: { id: input.cursor }, skip: 1 } : {}),
    });
    const hasMore = variants.length > input.limit;
    const page = hasMore ? variants.slice(0, input.limit) : variants;
    return {
      items: page.map((variant) => {
        const model = variant.assets.find((asset) => asset.kind === HoldAssetKind.MODEL_3D)!;
        const preview = variant.assets.find((asset) => asset.kind === HoldAssetKind.MODEL_PREVIEW);
        const warehouseQuantity = variant.inventory?.warehouseQuantity ?? 0;
        const mountingReady = variant.holdModel.mountingType === HoldMountingType.BOLT_ON;
        const dimensions = {
          width: variant.holdModel.widthMm ?? 120,
          height: variant.holdModel.heightMm ?? 120,
          depth: variant.holdModel.depthMm ?? 60,
        };
        return {
          assetId: variant.id,
          label: `${variant.holdModel.name} · ${variant.colorName}`,
          productName: variant.holdModel.name,
          manufacturer: variant.holdModel.brand,
          colorName: variant.colorName,
          colorHex: variant.colorHex,
          mountingType: variant.holdModel.mountingType,
          dimensionsMm: dimensions,
          collisionRadiusMm: Math.max(50, Math.hypot(dimensions.width, dimensions.height) / 2),
          modelUrl: `/backend/holds/assets/${encodeURIComponent(model.id)}/content`,
          previewUrl: preview
            ? `/backend/holds/assets/${encodeURIComponent(preview.id)}/content`
            : null,
          warehouseQuantity,
          reservedQuantity: variant.inventory?.reservedQuantity ?? 0,
          installedQuantity: variant.inventory?.installedQuantity ?? 0,
          inventoryVersion: variant.inventory?.version ?? 0,
          draggable: mountingReady && warehouseQuantity > 0,
          disabledReason: !mountingReady
            ? '安装孔型尚未确认，当前仅支持已确认的中心螺栓岩点'
            : warehouseQuantity < 1
              ? '仓库可用数量为 0'
              : null,
          mountPattern: {
            type: 'SINGLE_BOLT' as const,
            status: 'ESTIMATED_FROM_SCAN' as const,
            points: [{ role: 'PRIMARY_BOLT' as const, offsetXMm: 0, offsetZMm: 0 }],
          },
        };
      }),
      nextCursor: hasMore ? page.at(-1)!.id : null,
    };
  }
}
