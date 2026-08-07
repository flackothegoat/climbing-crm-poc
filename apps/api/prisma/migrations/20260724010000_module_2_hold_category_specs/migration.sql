CREATE TABLE "HoldCategory" (
  "id" TEXT NOT NULL,
  "organizationId" TEXT NOT NULL,
  "code" TEXT NOT NULL,
  "name" TEXT NOT NULL,
  "gripType" "HoldGripType" NOT NULL,
  "description" TEXT,
  "status" "HoldStatus" NOT NULL DEFAULT 'ACTIVE',
  "createdByAccountId" TEXT NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "HoldCategory_pkey" PRIMARY KEY ("id")
);

INSERT INTO "HoldCategory" (
  "id",
  "organizationId",
  "code",
  "name",
  "gripType",
  "description",
  "status",
  "createdByAccountId",
  "createdAt",
  "updatedAt"
)
SELECT
  'legacy_cat_' || substr(md5("organizationId" || ':' || "gripType"::text), 1, 20),
  "organizationId",
  (array_agg("code" ORDER BY "createdAt", "id"))[1],
  CASE "gripType"
    WHEN 'JUG' THEN '大把手'
    WHEN 'CRIMP' THEN '小扣点'
    WHEN 'SLOPER' THEN '斜面'
    WHEN 'PINCH' THEN '捏点'
    WHEN 'POCKET' THEN '指洞'
    WHEN 'FOOTHOLD' THEN '脚点'
    WHEN 'VOLUME' THEN '大型岩体'
    ELSE '其他岩点'
  END,
  "gripType",
  '由现有岩点数据自动整理的用途分类',
  CASE WHEN bool_or("status" = 'ACTIVE') THEN 'ACTIVE'::"HoldStatus" ELSE 'ARCHIVED'::"HoldStatus" END,
  (array_agg("createdByAccountId" ORDER BY "createdAt", "id"))[1],
  min("createdAt"),
  max("updatedAt")
FROM "HoldModel"
GROUP BY "organizationId", "gripType";

ALTER TABLE "HoldModel"
  ADD COLUMN "categoryId" TEXT,
  ADD COLUMN "productKey" TEXT;

UPDATE "HoldModel" AS model
SET "categoryId" = category."id"
FROM "HoldCategory" AS category
WHERE category."organizationId" = model."organizationId"
  AND category."gripType" = model."gripType";

WITH product_keys AS (
  SELECT
    "id",
    lower(trim(coalesce("brand", ''))) || '|' ||
      lower(trim("name")) || '|' ||
      "sizeClass"::text || '|' ||
      "mountingType"::text || '|' ||
      coalesce("widthMm"::text, '') || '|' ||
      coalesce("heightMm"::text, '') || '|' ||
      coalesce("depthMm"::text, '') AS base_key,
    row_number() OVER (
      PARTITION BY
        "categoryId",
        lower(trim(coalesce("brand", ''))),
        lower(trim("name")),
        "sizeClass",
        "mountingType",
        "widthMm",
        "heightMm",
        "depthMm"
      ORDER BY "createdAt", "id"
    ) AS duplicate_number
  FROM "HoldModel"
)
UPDATE "HoldModel" AS model
SET "productKey" = product_keys.base_key ||
  CASE
    WHEN product_keys.duplicate_number = 1 THEN ''
    ELSE '|legacy:' || model."id"
  END
FROM product_keys
WHERE product_keys."id" = model."id";

ALTER TABLE "HoldVariant" ADD COLUMN "colorKey" TEXT;

UPDATE "HoldVariant"
SET "colorKey" = lower(trim("colorName")) || '|' || upper("colorHex");

UPDATE "HoldVariant" AS variant
SET "status" = 'ARCHIVED'
FROM "HoldModel" AS model
WHERE model."id" = variant."holdModelId"
  AND model."status" = 'ARCHIVED';

UPDATE "HoldModel" SET "status" = 'ACTIVE';

ALTER TABLE "HoldModel"
  ALTER COLUMN "categoryId" SET NOT NULL,
  ALTER COLUMN "productKey" SET NOT NULL;

ALTER TABLE "HoldVariant" ALTER COLUMN "colorKey" SET NOT NULL;

CREATE UNIQUE INDEX "HoldCategory_organizationId_code_key"
  ON "HoldCategory"("organizationId", "code");
CREATE UNIQUE INDEX "HoldCategory_organizationId_gripType_key"
  ON "HoldCategory"("organizationId", "gripType");
CREATE INDEX "HoldCategory_organizationId_status_updatedAt_idx"
  ON "HoldCategory"("organizationId", "status", "updatedAt");
CREATE UNIQUE INDEX "HoldModel_categoryId_productKey_key"
  ON "HoldModel"("categoryId", "productKey");
CREATE INDEX "HoldModel_categoryId_idx" ON "HoldModel"("categoryId");
CREATE UNIQUE INDEX "HoldVariant_holdModelId_colorKey_key"
  ON "HoldVariant"("holdModelId", "colorKey");

ALTER TABLE "HoldCategory"
  ADD CONSTRAINT "HoldCategory_organizationId_fkey"
  FOREIGN KEY ("organizationId") REFERENCES "Organization"("id")
  ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "HoldCategory"
  ADD CONSTRAINT "HoldCategory_createdByAccountId_fkey"
  FOREIGN KEY ("createdByAccountId") REFERENCES "Account"("id")
  ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "HoldModel"
  ADD CONSTRAINT "HoldModel_categoryId_fkey"
  FOREIGN KEY ("categoryId") REFERENCES "HoldCategory"("id")
  ON DELETE RESTRICT ON UPDATE CASCADE;
