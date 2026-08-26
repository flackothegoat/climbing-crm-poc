import { config as loadDotenv } from 'dotenv';
import { resolve } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { Prisma } from '@prisma/client';
import { PrismaService } from './prisma.service';

loadDotenv({ path: resolve(process.cwd(), '../../.env') });

const integrationEnabled = process.env.DATABASE_INTEGRATION === 'true';
const prisma = new PrismaService();

describe.runIf(integrationEnabled)('PostgreSQL 领域约束集成检查', () => {
  beforeAll(() => prisma.$connect());
  afterAll(() => prisma.$disconnect());

  it('数据库拒绝墙孔引用其他岩馆的几何版本', async () => {
    await expect(
      prisma.$transaction(async (transaction) => {
        const first = await createWallFixture(transaction, 'first');
        const second = await createWallFixture(transaction, 'second');
        await transaction.wallHole.create({
          data: {
            organizationId: first.organizationId,
            wallSegmentId: first.wallSegmentId,
            geometryVersionId: second.geometryVersionId,
            code: 'INVALID-C01-R01',
            column: 0,
            row: 0,
            uMm: 0,
            vMm: 0,
          },
        });
      }),
    ).rejects.toThrow('WallHole geometry/segment/organization mismatch');
  });

  it('数据库拒绝 RFID 盘点引用其他岩馆的场馆', async () => {
    await expect(
      prisma.$transaction(async (transaction) => {
        const first = await createWallFixture(transaction, 'rfid-facility-first');
        const second = await createWallFixture(transaction, 'rfid-facility-second');
        const account = await transaction.account.create({
          data: {
            email: `integration-${crypto.randomUUID()}@example.com`,
            passwordHash: 'integration-only',
          },
        });
        await transaction.membership.create({
          data: {
            accountId: account.id,
            organizationId: first.organizationId,
            role: 'L1_ADMIN',
          },
        });
        const foreignFacility = await transaction.facility.create({
          data: {
            organizationId: second.organizationId,
            code: `FAC-${crypto.randomUUID()}`,
            name: '其他岩馆场馆',
          },
        });
        await transaction.rfidInventorySession.create({
          data: {
            organizationId: first.organizationId,
            facilityId: foreignFacility.id,
            requestKey: crypto.randomUUID(),
            name: '跨馆 RFID 盘点',
            targetPhysicalStatus: 'WAREHOUSE',
            createdByAccountId: account.id,
          },
        });
      }),
    ).rejects.toThrow('RfidInventorySession scope mismatch');
  });

  it('数据库拒绝非本岩馆成员创建 RFID 盘点', async () => {
    await expect(
      prisma.$transaction(async (transaction) => {
        const first = await createWallFixture(transaction, 'rfid-actor-first');
        const second = await createWallFixture(transaction, 'rfid-actor-second');
        const account = await transaction.account.create({
          data: {
            email: `integration-${crypto.randomUUID()}@example.com`,
            passwordHash: 'integration-only',
          },
        });
        await transaction.membership.create({
          data: {
            accountId: account.id,
            organizationId: second.organizationId,
            role: 'L1_ADMIN',
          },
        });
        const facility = await transaction.facility.create({
          data: {
            organizationId: first.organizationId,
            code: `FAC-${crypto.randomUUID()}`,
            name: '本岩馆场馆',
          },
        });
        await transaction.rfidInventorySession.create({
          data: {
            organizationId: first.organizationId,
            facilityId: facility.id,
            requestKey: crypto.randomUUID(),
            name: '越权 RFID 盘点',
            targetPhysicalStatus: 'WAREHOUSE',
            createdByAccountId: account.id,
          },
        });
      }),
    ).rejects.toThrow('RfidInventorySession creator scope mismatch');
  });

  it('数据库在事务提交时拒绝没有主锚点的线路岩点位置', async () => {
    await expect(
      prisma.$transaction(async (transaction) => {
        const wall = await createWallFixture(transaction, 'placement');
        const account = await transaction.account.create({
          data: {
            email: `integration-${crypto.randomUUID()}@example.com`,
            passwordHash: 'integration-only',
          },
        });
        const category = await transaction.holdCategory.create({
          data: {
            organizationId: wall.organizationId,
            code: `CAT-${crypto.randomUUID()}`,
            name: '集成测试分类',
            gripType: 'OTHER',
            createdByAccountId: account.id,
          },
        });
        const model = await transaction.holdModel.create({
          data: {
            organizationId: wall.organizationId,
            categoryId: category.id,
            code: `MODEL-${crypto.randomUUID()}`,
            name: '集成测试岩点',
            gripType: 'OTHER',
            sizeClass: 'M',
            productKey: crypto.randomUUID(),
            createdByAccountId: account.id,
          },
        });
        const variant = await transaction.holdVariant.create({
          data: {
            holdModelId: model.id,
            color: 'GRAY',
            activeColor: 'GRAY',
          },
        });
        const hole = await transaction.wallHole.create({
          data: {
            organizationId: wall.organizationId,
            wallSegmentId: wall.wallSegmentId,
            geometryVersionId: wall.geometryVersionId,
            code: 'C01-R01',
            column: 0,
            row: 0,
            uMm: 0,
            vMm: 0,
          },
        });
        const route = await transaction.route.create({
          data: {
            organizationId: wall.organizationId,
            code: `ROUTE-${crypto.randomUUID()}`,
            name: '集成测试线路',
            color: 'GRAY',
            grade: 'V1',
          },
        });
        const version = await transaction.routeVersion.create({
          data: {
            organizationId: wall.organizationId,
            routeId: route.id,
            versionNumber: 1,
            createdByAccountId: account.id,
          },
        });
        await transaction.routeVersionWallSegment.create({
          data: {
            organizationId: wall.organizationId,
            routeVersionId: version.id,
            wallSegmentId: wall.wallSegmentId,
            geometryVersionId: wall.geometryVersionId,
            ordinal: 0,
          },
        });
        await transaction.routeHoldPlacement.create({
          data: {
            organizationId: wall.organizationId,
            routeVersionId: version.id,
            wallHoleId: hole.id,
            holdVariantId: variant.id,
            rotationDegrees: 0,
          },
        });
      }),
    ).rejects.toThrow('RouteHoldPlacement requires exactly one primary anchor');
  });

  it('数据库拒绝移动锚点后让原线路位置失去主锚点', async () => {
    await expect(
      prisma.$transaction(async (transaction) => {
        const fixture = await createPlacementFixture(transaction, 'anchor-move');
        const firstHole = await createHole(transaction, fixture.wall, 'MOVE-01', 0);
        const secondHole = await createHole(transaction, fixture.wall, 'MOVE-02', 1);
        const firstPlacement = await transaction.routeHoldPlacement.create({
          data: {
            organizationId: fixture.wall.organizationId,
            routeVersionId: fixture.routeVersionId,
            wallHoleId: firstHole.id,
            holdVariantId: fixture.variantId,
            rotationDegrees: 0,
          },
        });
        const secondPlacement = await transaction.routeHoldPlacement.create({
          data: {
            organizationId: fixture.wall.organizationId,
            routeVersionId: fixture.routeVersionId,
            wallHoleId: secondHole.id,
            holdVariantId: fixture.variantId,
            rotationDegrees: 0,
          },
        });
        const firstAnchor = await transaction.routeHoldPlacementAnchor.create({
          data: {
            organizationId: fixture.wall.organizationId,
            placementId: firstPlacement.id,
            wallHoleId: firstHole.id,
            role: 'PRIMARY',
            ordinal: 0,
          },
        });
        await transaction.routeHoldPlacementAnchor.create({
          data: {
            organizationId: fixture.wall.organizationId,
            placementId: secondPlacement.id,
            wallHoleId: secondHole.id,
            role: 'PRIMARY',
            ordinal: 0,
          },
        });
        await transaction.routeHoldPlacementAnchor.update({
          where: { id: firstAnchor.id },
          data: { placementId: secondPlacement.id, role: 'SECONDARY', ordinal: 1 },
        });
      }),
    ).rejects.toThrow('RouteHoldPlacement requires exactly one primary anchor');
  });

  it('数据库拒绝定线任务预留其他岩馆的岩点', async () => {
    await expect(
      prisma.$transaction(async (transaction) => {
        const first = await createWallFixture(transaction, 'reservation-first');
        const second = await createWallFixture(transaction, 'reservation-second');
        const account = await transaction.account.create({
          data: {
            email: `integration-${crypto.randomUUID()}@example.com`,
            passwordHash: 'integration-only',
          },
        });
        const category = await transaction.holdCategory.create({
          data: {
            organizationId: second.organizationId,
            code: `CAT-${crypto.randomUUID()}`,
            name: '跨岩馆约束测试分类',
            gripType: 'OTHER',
            createdByAccountId: account.id,
          },
        });
        const model = await transaction.holdModel.create({
          data: {
            organizationId: second.organizationId,
            categoryId: category.id,
            code: `MODEL-${crypto.randomUUID()}`,
            name: '跨岩馆约束测试岩点',
            gripType: 'OTHER',
            sizeClass: 'M',
            productKey: crypto.randomUUID(),
            createdByAccountId: account.id,
          },
        });
        const variant = await transaction.holdVariant.create({
          data: {
            holdModelId: model.id,
            color: 'GRAY',
            activeColor: 'GRAY',
          },
        });
        const job = await transaction.wallSettingJob.create({
          data: {
            organizationId: first.organizationId,
            code: `SETTING-${crypto.randomUUID()}`,
            name: '跨岩馆约束测试任务',
            createdByAccountId: account.id,
          },
        });
        await transaction.wallSettingJobHoldReservation.create({
          data: {
            organizationId: first.organizationId,
            settingJobId: job.id,
            holdVariantId: variant.id,
            quantity: 1,
          },
        });
      }),
    ).rejects.toThrow('WallSettingJobHoldReservation scope mismatch');
  });

  it('数据库拒绝二维码反馈跨线路版本或跨岩馆归属', async () => {
    await expect(
      prisma.$transaction(async (transaction) => {
        const first = await createWallFixture(transaction, 'feedback-first');
        const second = await createWallFixture(transaction, 'feedback-second');
        const account = await transaction.account.create({
          data: {
            email: `integration-${crypto.randomUUID()}@example.com`,
            passwordHash: 'integration-only',
          },
        });
        await transaction.membership.create({
          data: {
            accountId: account.id,
            organizationId: first.organizationId,
            role: 'L1_ADMIN',
          },
        });
        const firstRoute = await transaction.route.create({
          data: {
            organizationId: first.organizationId,
            code: `ROUTE-${crypto.randomUUID()}`,
            name: '第一岩馆线路',
            color: 'GREEN',
            grade: 'V3',
            status: 'PUBLISHED',
          },
        });
        const secondRoute = await transaction.route.create({
          data: {
            organizationId: second.organizationId,
            code: `ROUTE-${crypto.randomUUID()}`,
            name: '第二岩馆线路',
            color: 'RED',
            grade: 'V4',
            status: 'PUBLISHED',
          },
        });
        const secondVersion = await transaction.routeVersion.create({
          data: {
            organizationId: second.organizationId,
            routeId: secondRoute.id,
            versionNumber: 1,
            status: 'PUBLISHED',
            createdByAccountId: account.id,
          },
        });
        const link = await transaction.routePublicLink.create({
          data: {
            organizationId: first.organizationId,
            routeId: firstRoute.id,
            tokenHash: crypto.randomUUID(),
            activeRouteKey: firstRoute.id,
            createdByAccountId: account.id,
          },
        });
        await transaction.routeFeedback.create({
          data: {
            organizationId: first.organizationId,
            routeId: firstRoute.id,
            routeVersionId: secondVersion.id,
            publicLinkId: link.id,
            outcome: 'ATTEMPTING',
            difficulty: 'AS_EXPECTED',
            enjoyment: 'LIKE',
            anonymousSessionKey: crypto.randomUUID(),
            requestKey: crypto.randomUUID(),
          },
        });
      }),
    ).rejects.toThrow('RouteFeedback scope mismatch');
  });

  it('数据库拒绝把线路视觉点写到版本未关联或其他岩馆的墙段', async () => {
    await expect(
      prisma.$transaction(async (transaction) => {
        const first = await createWallFixture(transaction, 'visual-first');
        const second = await createWallFixture(transaction, 'visual-second');
        const account = await transaction.account.create({
          data: {
            email: `integration-${crypto.randomUUID()}@example.com`,
            passwordHash: 'integration-only',
          },
        });
        await transaction.membership.create({
          data: {
            accountId: account.id,
            organizationId: first.organizationId,
            role: 'L1_ADMIN',
          },
        });
        const route = await transaction.route.create({
          data: {
            organizationId: first.organizationId,
            code: `ROUTE-${crypto.randomUUID()}`,
            name: '视觉标注约束测试',
            color: 'GREEN',
            grade: 'V3',
          },
        });
        const version = await transaction.routeVersion.create({
          data: {
            organizationId: first.organizationId,
            routeId: route.id,
            versionNumber: 1,
            createdByAccountId: account.id,
          },
        });
        await transaction.routeVersionWallSegment.create({
          data: {
            organizationId: first.organizationId,
            routeVersionId: version.id,
            wallSegmentId: first.wallSegmentId,
            ordinal: 0,
          },
        });
        const annotation = await transaction.routeVisualAnnotation.create({
          data: {
            organizationId: first.organizationId,
            routeVersionId: version.id,
            revision: 1,
            createdByAccountId: account.id,
          },
        });
        await transaction.routeVisualPoint.create({
          data: {
            organizationId: first.organizationId,
            annotationId: annotation.id,
            wallSegmentId: second.wallSegmentId,
            ordinal: 0,
            role: 'START',
            uNormalized: 0.2,
            vNormalized: 0.8,
          },
        });
      }),
    ).rejects.toThrow('RouteVisualPoint scope mismatch');
  });
});

async function createPlacementFixture(transaction: Prisma.TransactionClient, suffix: string) {
  const wall = await createWallFixture(transaction, suffix);
  const account = await transaction.account.create({
    data: {
      email: `integration-${crypto.randomUUID()}@example.com`,
      passwordHash: 'integration-only',
    },
  });
  const category = await transaction.holdCategory.create({
    data: {
      organizationId: wall.organizationId,
      code: `CAT-${crypto.randomUUID()}`,
      name: '集成测试分类',
      gripType: 'OTHER',
      createdByAccountId: account.id,
    },
  });
  const model = await transaction.holdModel.create({
    data: {
      organizationId: wall.organizationId,
      categoryId: category.id,
      code: `MODEL-${crypto.randomUUID()}`,
      name: '集成测试岩点',
      gripType: 'OTHER',
      sizeClass: 'M',
      productKey: crypto.randomUUID(),
      createdByAccountId: account.id,
    },
  });
  const variant = await transaction.holdVariant.create({
    data: {
      holdModelId: model.id,
      color: 'GRAY',
      activeColor: 'GRAY',
    },
  });
  const route = await transaction.route.create({
    data: {
      organizationId: wall.organizationId,
      code: `ROUTE-${crypto.randomUUID()}`,
      name: '集成测试线路',
      color: 'GRAY',
      grade: 'V1',
    },
  });
  const version = await transaction.routeVersion.create({
    data: {
      organizationId: wall.organizationId,
      routeId: route.id,
      versionNumber: 1,
      createdByAccountId: account.id,
    },
  });
  await transaction.routeVersionWallSegment.create({
    data: {
      organizationId: wall.organizationId,
      routeVersionId: version.id,
      wallSegmentId: wall.wallSegmentId,
      geometryVersionId: wall.geometryVersionId,
      ordinal: 0,
    },
  });
  return { wall, routeVersionId: version.id, variantId: variant.id };
}

function createHole(
  transaction: Prisma.TransactionClient,
  wall: Awaited<ReturnType<typeof createWallFixture>>,
  code: string,
  column: number,
) {
  return transaction.wallHole.create({
    data: {
      organizationId: wall.organizationId,
      wallSegmentId: wall.wallSegmentId,
      geometryVersionId: wall.geometryVersionId,
      code,
      column,
      row: 0,
      uMm: column * 200,
      vMm: 0,
    },
  });
}

async function createWallFixture(transaction: Prisma.TransactionClient, suffix: string) {
  const organization = await transaction.organization.create({
    data: { name: `Integration ${suffix} ${crypto.randomUUID()}` },
  });
  const area = await transaction.wallArea.create({
    data: {
      organizationId: organization.id,
      code: `AREA-${crypto.randomUUID()}`,
      name: `Integration area ${suffix}`,
    },
  });
  const segment = await transaction.wallSegment.create({
    data: {
      organizationId: organization.id,
      areaId: area.id,
      code: `W-${crypto.randomUUID()}`,
      name: `Integration wall ${suffix}`,
    },
  });
  const geometry = await transaction.wallGeometryVersion.create({
    data: {
      organizationId: organization.id,
      wallSegmentId: segment.id,
      versionNumber: 1,
      widthMm: 1_000,
      heightMm: 1_000,
    },
  });
  return {
    organizationId: organization.id,
    wallSegmentId: segment.id,
    geometryVersionId: geometry.id,
  };
}
