ALTER TABLE "RouteHoldPlacement" DROP CONSTRAINT "RouteHoldPlacement_rotation_check";

ALTER TABLE "RouteHoldPlacement"
ADD CONSTRAINT "RouteHoldPlacement_rotation_check"
CHECK ("rotationDegrees" BETWEEN -359 AND 359);
