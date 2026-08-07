-- 模块 2.3A：岩点型号、颜色变体、库存余额和不可变库存流水。
-- 回滚会丢失全部岩点库存历史；生产环境只能在备份并确认无业务数据后逆序删除。
CREATE TYPE "HoldStatus" AS ENUM ('ACTIVE', 'ARCHIVED');
CREATE TYPE "HoldGripType" AS ENUM ('JUG', 'CRIMP', 'SLOPER', 'PINCH', 'POCKET', 'FOOTHOLD', 'VOLUME', 'OTHER');
CREATE TYPE "HoldSizeClass" AS ENUM ('XS', 'S', 'M', 'L', 'XL', 'XXL');
CREATE TYPE "HoldMountingType" AS ENUM ('BOLT_ON', 'SCREW_ON', 'DUAL', 'UNKNOWN');
CREATE TYPE "InventoryBucket" AS ENUM ('WAREHOUSE', 'INSTALLED', 'RESERVED', 'MAINTENANCE');
CREATE TYPE "InventoryMovementType" AS ENUM (
  'INITIAL_BALANCE', 'RECEIPT', 'ADJUSTMENT', 'INSTALL', 'REMOVE',
  'RESERVE', 'RELEASE', 'MAINTENANCE_IN', 'MAINTENANCE_OUT', 'RETIRE'
);
CREATE TYPE "InventoryVerificationStatus" AS ENUM ('UNVERIFIED', 'PARTIAL', 'VERIFIED');

CREATE TABLE "HoldModel" (
  "id" TEXT NOT NULL,
  "organizationId" TEXT NOT NULL,
  "code" TEXT NOT NULL,
  "name" TEXT NOT NULL,
  "brand" TEXT,
  "gripType" "HoldGripType" NOT NULL,
  "style" TEXT,
  "sizeClass" "HoldSizeClass" NOT NULL,
  "widthMm" INTEGER,
  "heightMm" INTEGER,
  "depthMm" INTEGER,
  "mountingType" "HoldMountingType" NOT NULL DEFAULT 'UNKNOWN',
  "description" TEXT,
  "status" "HoldStatus" NOT NULL DEFAULT 'ACTIVE',
  "createdByAccountId" TEXT NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "HoldModel_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "HoldModel_dimensions_check" CHECK (
    ("widthMm" IS NULL OR "widthMm" > 0) AND
    ("heightMm" IS NULL OR "heightMm" > 0) AND
    ("depthMm" IS NULL OR "depthMm" > 0)
  )
);

CREATE TABLE "HoldVariant" (
  "id" TEXT NOT NULL,
  "holdModelId" TEXT NOT NULL,
  "colorName" TEXT NOT NULL,
  "colorHex" TEXT NOT NULL,
  "sku" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "HoldVariant_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "HoldInventoryBalance" (
  "id" TEXT NOT NULL,
  "variantId" TEXT NOT NULL,
  "warehouseQuantity" INTEGER NOT NULL DEFAULT 0,
  "installedQuantity" INTEGER NOT NULL DEFAULT 0,
  "reservedQuantity" INTEGER NOT NULL DEFAULT 0,
  "maintenanceQuantity" INTEGER NOT NULL DEFAULT 0,
  "verificationStatus" "InventoryVerificationStatus" NOT NULL DEFAULT 'UNVERIFIED',
  "version" INTEGER NOT NULL DEFAULT 0,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "HoldInventoryBalance_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "HoldInventoryBalance_nonnegative_check" CHECK (
    "warehouseQuantity" >= 0 AND "installedQuantity" >= 0 AND
    "reservedQuantity" >= 0 AND "maintenanceQuantity" >= 0
  )
);

CREATE TABLE "HoldInventoryMovement" (
  "id" TEXT NOT NULL,
  "organizationId" TEXT NOT NULL,
  "variantId" TEXT NOT NULL,
  "type" "InventoryMovementType" NOT NULL,
  "bucket" "InventoryBucket" NOT NULL,
  "quantityDelta" INTEGER NOT NULL,
  "beforeQuantity" INTEGER NOT NULL,
  "afterQuantity" INTEGER NOT NULL,
  "note" TEXT,
  "referenceType" TEXT,
  "referenceId" TEXT,
  "actorAccountId" TEXT NOT NULL,
  "occurredAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "HoldInventoryMovement_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "HoldInventoryMovement_quantity_check" CHECK (
    "quantityDelta" <> 0 AND "beforeQuantity" >= 0 AND "afterQuantity" >= 0 AND
    "afterQuantity" - "beforeQuantity" = "quantityDelta"
  )
);

CREATE UNIQUE INDEX "HoldModel_organizationId_code_key" ON "HoldModel"("organizationId", "code");
CREATE INDEX "HoldModel_organizationId_status_updatedAt_idx" ON "HoldModel"("organizationId", "status", "updatedAt");
CREATE UNIQUE INDEX "HoldVariant_holdModelId_colorName_key" ON "HoldVariant"("holdModelId", "colorName");
CREATE INDEX "HoldVariant_holdModelId_idx" ON "HoldVariant"("holdModelId");
CREATE UNIQUE INDEX "HoldInventoryBalance_variantId_key" ON "HoldInventoryBalance"("variantId");
CREATE INDEX "HoldInventoryMovement_organizationId_occurredAt_idx" ON "HoldInventoryMovement"("organizationId", "occurredAt");
CREATE INDEX "HoldInventoryMovement_variantId_occurredAt_idx" ON "HoldInventoryMovement"("variantId", "occurredAt");

ALTER TABLE "HoldModel" ADD CONSTRAINT "HoldModel_organizationId_fkey"
  FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "HoldModel" ADD CONSTRAINT "HoldModel_createdByAccountId_fkey"
  FOREIGN KEY ("createdByAccountId") REFERENCES "Account"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "HoldVariant" ADD CONSTRAINT "HoldVariant_holdModelId_fkey"
  FOREIGN KEY ("holdModelId") REFERENCES "HoldModel"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "HoldInventoryBalance" ADD CONSTRAINT "HoldInventoryBalance_variantId_fkey"
  FOREIGN KEY ("variantId") REFERENCES "HoldVariant"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "HoldInventoryMovement" ADD CONSTRAINT "HoldInventoryMovement_organizationId_fkey"
  FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "HoldInventoryMovement" ADD CONSTRAINT "HoldInventoryMovement_variantId_fkey"
  FOREIGN KEY ("variantId") REFERENCES "HoldVariant"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "HoldInventoryMovement" ADD CONSTRAINT "HoldInventoryMovement_actorAccountId_fkey"
  FOREIGN KEY ("actorAccountId") REFERENCES "Account"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
