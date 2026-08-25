-- Colors are business categories, not arbitrary RGB values.
-- CSS swatches remain a presentation concern in the web application.

CREATE TYPE "ClimbingColor" AS ENUM (
  'BLACK', 'WHITE', 'GRAY', 'RED', 'ORANGE', 'YELLOW',
  'GREEN', 'BLUE', 'PURPLE', 'PINK', 'BROWN'
);

ALTER TABLE "HoldVariant"
  ADD COLUMN "color" "ClimbingColor",
  ADD COLUMN "activeColor" "ClimbingColor";

UPDATE "HoldVariant"
SET "color" = CASE
  WHEN lower(trim("colorName")) IN ('黑', '黑色', 'black') THEN 'BLACK'::"ClimbingColor"
  WHEN lower(trim("colorName")) IN ('白', '白色', 'white') THEN 'WHITE'::"ClimbingColor"
  WHEN lower(trim("colorName")) IN ('灰', '灰色', 'gray', 'grey') THEN 'GRAY'::"ClimbingColor"
  WHEN lower(trim("colorName")) IN ('红', '红色', 'red') THEN 'RED'::"ClimbingColor"
  WHEN lower(trim("colorName")) IN ('橙', '橙色', 'orange') THEN 'ORANGE'::"ClimbingColor"
  WHEN lower(trim("colorName")) IN ('黄', '黄色', 'yellow') THEN 'YELLOW'::"ClimbingColor"
  WHEN lower(trim("colorName")) IN ('绿', '绿色', 'green') THEN 'GREEN'::"ClimbingColor"
  WHEN lower(trim("colorName")) IN ('蓝', '蓝色', 'blue') THEN 'BLUE'::"ClimbingColor"
  WHEN lower(trim("colorName")) IN ('紫', '紫色', 'purple') THEN 'PURPLE'::"ClimbingColor"
  WHEN lower(trim("colorName")) IN ('粉', '粉色', 'pink') THEN 'PINK'::"ClimbingColor"
  WHEN lower(trim("colorName")) IN ('棕', '棕色', '褐色', 'brown') THEN 'BROWN'::"ClimbingColor"
  WHEN upper("colorHex") IN ('#F20D0D', '#F56B6B', '#EF4050') THEN 'RED'::"ClimbingColor"
  WHEN upper("colorHex") IN ('#D8F56C', '#DCD618', '#F0B415') THEN 'YELLOW'::"ClimbingColor"
  WHEN upper("colorHex") IN ('#3EBD0F', '#6BF56D', '#22A868') THEN 'GREEN'::"ClimbingColor"
  WHEN upper("colorHex") = '#746BF5' THEN 'PURPLE'::"ClimbingColor"
  WHEN upper("colorHex") = '#F56B87' THEN 'PINK'::"ClimbingColor"
  ELSE 'GRAY'::"ClimbingColor"
END;

UPDATE "HoldVariant"
SET "activeColor" = CASE WHEN "activeColorKey" IS NULL THEN NULL ELSE "color" END;

ALTER TABLE "HoldVariant" ALTER COLUMN "color" SET NOT NULL;
DROP INDEX "HoldVariant_holdModelId_activeColorKey_key";
CREATE UNIQUE INDEX "HoldVariant_holdModelId_activeColor_key"
  ON "HoldVariant"("holdModelId", "activeColor");

ALTER TABLE "HoldVariant"
  DROP COLUMN "colorName",
  DROP COLUMN "colorHex",
  DROP COLUMN "colorKey",
  DROP COLUMN "activeColorKey";

ALTER TABLE "Route" ADD COLUMN "color" "ClimbingColor";
UPDATE "Route"
SET "color" = CASE
  WHEN lower(trim("displayColor")) IN ('black', '#000000', '#202623') THEN 'BLACK'::"ClimbingColor"
  WHEN lower(trim("displayColor")) IN ('white', '#ffffff', '#f7f7f2') THEN 'WHITE'::"ClimbingColor"
  WHEN lower(trim("displayColor")) IN ('gray', 'grey', '#888888', '#8a918d') THEN 'GRAY'::"ClimbingColor"
  WHEN lower(trim("displayColor")) IN ('red', '#e34a4a', '#ef4050', '#f20d0d', '#f56b6b', '#aa2266') THEN 'RED'::"ClimbingColor"
  WHEN lower(trim("displayColor")) IN ('orange', '#f28c28') THEN 'ORANGE'::"ClimbingColor"
  WHEN lower(trim("displayColor")) IN ('yellow', '#e3b91f', '#eab728', '#d8f56c', '#dcd618', '#f0b415') THEN 'YELLOW'::"ClimbingColor"
  WHEN lower(trim("displayColor")) IN ('green', '#2ead68', '#27a96e', '#2fb36d', '#3ebd0f', '#6bf56d', '#22a868', '#22aa66') THEN 'GREEN'::"ClimbingColor"
  WHEN lower(trim("displayColor")) IN ('blue', '#3478d4', '#2d7ff9') THEN 'BLUE'::"ClimbingColor"
  WHEN lower(trim("displayColor")) IN ('purple', '#7654c6', '#746bf5') THEN 'PURPLE'::"ClimbingColor"
  WHEN lower(trim("displayColor")) IN ('pink', '#e66d9c', '#f56b87') THEN 'PINK'::"ClimbingColor"
  WHEN lower(trim("displayColor")) IN ('brown', '#8a5a3b') THEN 'BROWN'::"ClimbingColor"
  ELSE 'GRAY'::"ClimbingColor"
END;
ALTER TABLE "Route" ALTER COLUMN "color" SET NOT NULL;
ALTER TABLE "Route" DROP COLUMN "displayColor";

ALTER TABLE "RouteVersion" ADD COLUMN "color" "ClimbingColor";
UPDATE "RouteVersion" version
SET "color" = route."color"
FROM "Route" route
WHERE route."id" = version."routeId" AND version."displayColor" IS NOT NULL;
ALTER TABLE "RouteVersion" DROP COLUMN "displayColor";
