import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { HoldAssetService } from './hold-asset.service';
import { HoldCategoryService } from './hold-category.service';
import { HoldController } from './hold.controller';
import { HoldInitializationService } from './hold-initialization.service';
import { HoldInventoryService } from './hold-inventory.service';
import { HoldModelProcessingService } from './hold-model-processing.service';
import { HoldRecordDeletionService } from './hold-record-deletion.service';
import { HoldScanService } from './hold-scan.service';
import { HoldSpecificationService } from './hold-specification.service';
import { HoldSpecificationWriter } from './hold-specification.writer';
import { HoldUnitService } from './hold-unit.service';
import { RfidInventoryController } from './rfid-inventory.controller';
import { RfidInventoryService } from './rfid-inventory.service';

@Module({
  imports: [AuthModule],
  controllers: [HoldController, RfidInventoryController],
  providers: [
    HoldCategoryService,
    HoldSpecificationService,
    HoldSpecificationWriter,
    HoldInventoryService,
    HoldModelProcessingService,
    HoldAssetService,
    HoldInitializationService,
    HoldScanService,
    HoldRecordDeletionService,
    HoldUnitService,
    RfidInventoryService,
  ],
  exports: [HoldInventoryService],
})
export class HoldsModule {}
