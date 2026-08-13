import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { HoldAssetService } from './hold-asset.service';
import { HoldCategoryService } from './hold-category.service';
import { HoldController } from './hold.controller';
import { HoldInitializationService } from './hold-initialization.service';
import { HoldInventoryService } from './hold-inventory.service';
import { HoldRecordDeletionService } from './hold-record-deletion.service';
import { HoldScanService } from './hold-scan.service';
import { HoldSpecificationService } from './hold-specification.service';
import { HoldSpecificationWriter } from './hold-specification.writer';

@Module({
  imports: [AuthModule],
  controllers: [HoldController],
  providers: [
    HoldCategoryService,
    HoldSpecificationService,
    HoldSpecificationWriter,
    HoldInventoryService,
    HoldAssetService,
    HoldInitializationService,
    HoldScanService,
    HoldRecordDeletionService,
  ],
  exports: [HoldInventoryService],
})
export class HoldsModule {}
