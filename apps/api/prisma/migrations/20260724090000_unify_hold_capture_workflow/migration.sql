CREATE TYPE "HoldScanMode" AS ENUM ('CREATE_SPECIFICATION', 'ENRICH_SPECIFICATION');

ALTER TABLE "HoldScan"
  ADD COLUMN "mode" "HoldScanMode" NOT NULL DEFAULT 'CREATE_SPECIFICATION',
  ALTER COLUMN "initializationBatchId" DROP NOT NULL;

-- 旧扫描模型继续保留；只在不会与现有人工款型冲突时，将文件 Hash 身份迁移为业务属性身份。
WITH normalized_models AS (
  SELECT
    "id",
    "categoryId",
    lower(regexp_replace(trim(coalesce("brand", '')), '\s+', ' ', 'g')) || '|' ||
    lower(regexp_replace(trim("name"), '\s+', ' ', 'g')) || '|' ||
    lower("sizeClass"::text) || '|' || lower("mountingType"::text) || '|' ||
    coalesce("widthMm"::text, '') || '|' || coalesce("heightMm"::text, '') || '|' ||
    coalesce("depthMm"::text, '') AS desired_key
  FROM "HoldModel"
  WHERE "identitySource" = 'SCAN'
), safe_models AS (
  SELECT normalized.*
  FROM normalized_models normalized
  WHERE NOT EXISTS (
    SELECT 1
    FROM "HoldModel" existing
    WHERE existing."categoryId" = normalized."categoryId"
      AND existing."productKey" = normalized.desired_key
      AND existing."id" <> normalized."id"
  )
)
UPDATE "HoldModel" model
SET "productKey" = safe_models.desired_key
FROM safe_models
WHERE model."id" = safe_models."id";
