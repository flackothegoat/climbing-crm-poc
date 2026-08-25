import {
  BadRequestException,
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  Param,
  Patch,
  Post,
  Query,
  Req,
  StreamableFile,
  UseGuards,
} from '@nestjs/common';
import type { FastifyRequest } from 'fastify';
import { ApiCookieAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { CurrentSessionContext } from '../auth/current-session.decorator';
import { SessionGuard } from '../auth/session.guard';
import type { CurrentSession } from '../auth/session.service';
import { HoldCategoryService } from './hold-category.service';
import {
  parseAddSpecification,
  parseAssetKind,
  parseCreateScan,
  parseCreateCategory,
  parseCreateHoldRecord,
  parseListCategories,
  parseFinalizeScan,
  parseInitializeSpecification,
  parsePermanentlyDeleteSpecification,
  parsePreviewGenerationVersion,
  parseReverseMovement,
  parseStockMovement,
  parseStartInitialization,
  parseUpdateCategory,
  parseUpdateSpecification,
} from './hold.dto';
import { HoldInventoryService } from './hold-inventory.service';
import { HoldAssetService } from './hold-asset.service';
import { HoldInitializationService } from './hold-initialization.service';
import { HoldScanService } from './hold-scan.service';
import { HoldSpecificationService } from './hold-specification.service';
import { HoldRecordDeletionService } from './hold-record-deletion.service';
import { HoldModelProcessingService } from './hold-model-processing.service';

@ApiTags('holds')
@ApiCookieAuth()
@UseGuards(SessionGuard)
@Controller('holds')
export class HoldController {
  constructor(
    private readonly categories: HoldCategoryService,
    private readonly specifications: HoldSpecificationService,
    private readonly recordDeletion: HoldRecordDeletionService,
    private readonly inventory: HoldInventoryService,
    private readonly assets: HoldAssetService,
    private readonly scans: HoldScanService,
    private readonly initialization: HoldInitializationService,
    private readonly modelProcessing: HoldModelProcessingService,
  ) {}

  @Get('initialization/active')
  @ApiOperation({ summary: '获取当前进行中的全馆岩点初始化批次' })
  getActiveInitialization(@CurrentSessionContext() session: CurrentSession) {
    return this.initialization.getActive(session);
  }

  @Get('scans/:scanId/model-processing')
  @ApiOperation({ summary: '获取扫描草稿的后台模型清理状态' })
  getModelProcessing(
    @CurrentSessionContext() session: CurrentSession,
    @Param('scanId') scanId: string,
  ) {
    return this.modelProcessing.getForScan(session, scanId);
  }

  @Post('model-processing/:jobId/retry')
  @ApiOperation({ summary: '重新排队失败的模型清理任务' })
  retryModelProcessing(
    @CurrentSessionContext() session: CurrentSession,
    @Param('jobId') jobId: string,
  ) {
    return this.modelProcessing.retry(session, jobId);
  }

  @Post('initialization/batches')
  @ApiOperation({ summary: '开始一个全馆岩点初始化批次' })
  startInitialization(@CurrentSessionContext() session: CurrentSession, @Body() body: unknown) {
    return this.initialization.start(session, parseStartInitialization(body));
  }

  @Post('initialization/batches/:batchId/complete')
  @HttpCode(204)
  @ApiOperation({ summary: '完成全馆岩点初始化批次' })
  completeInitialization(
    @CurrentSessionContext() session: CurrentSession,
    @Param('batchId') batchId: string,
  ) {
    return this.initialization.complete(session, batchId);
  }

  @Delete('initialization/batches/:batchId')
  @HttpCode(204)
  @ApiOperation({ summary: '取消尚未产生盘点记录的初始化批次' })
  cancelInitialization(
    @CurrentSessionContext() session: CurrentSession,
    @Param('batchId') batchId: string,
  ) {
    return this.initialization.cancelEmpty(session, batchId);
  }

  @Post('scans')
  @ApiOperation({ summary: '创建岩点扫描草稿' })
  createScan(@CurrentSessionContext() session: CurrentSession, @Body() body: unknown) {
    return this.scans.create(session, parseCreateScan(body));
  }

  @Post('scans/:scanId/assets')
  @ApiOperation({ summary: '上传扫描草稿的 GLB 模型或参考照片' })
  async uploadScanAsset(
    @CurrentSessionContext() session: CurrentSession,
    @Param('scanId') scanId: string,
    @Query('kind') rawKind: unknown,
    @Req() request: FastifyRequest,
  ) {
    const file = await request.file();
    if (!file) throw new BadRequestException('请选择需要上传的文件');
    return this.assets.upload(session, scanId, parseAssetKind(rawKind), file);
  }

  @Post('scans/:scanId/finalize')
  @ApiOperation({ summary: '根据采集实物创建岩点档案，可选写入初始化实数' })
  finalizeScan(
    @CurrentSessionContext() session: CurrentSession,
    @Param('scanId') scanId: string,
    @Body() body: unknown,
  ) {
    return this.scans.finalize(session, scanId, parseFinalizeScan(body));
  }

  @Post('assets/:assetId/preview')
  @ApiOperation({ summary: '为三维岩点模型保存派生 WebP 缩略图' })
  async uploadModelPreview(
    @CurrentSessionContext() session: CurrentSession,
    @Param('assetId') assetId: string,
    @Query('generationVersion') rawVersion: unknown,
    @Req() request: FastifyRequest,
  ) {
    const file = await request.file();
    if (!file) throw new BadRequestException('请选择需要上传的缩略图');
    return this.assets.uploadPreview(
      session,
      assetId,
      parsePreviewGenerationVersion(rawVersion),
      file,
    );
  }

  @Post('scans/:scanId/complete-attachment')
  @HttpCode(204)
  @ApiOperation({ summary: '把采集的三维模型关联到已有岩点档案' })
  completeScanAttachment(
    @CurrentSessionContext() session: CurrentSession,
    @Param('scanId') scanId: string,
  ) {
    return this.scans.completeAttachment(session, scanId);
  }

  @Delete('scans/:scanId')
  @HttpCode(204)
  @ApiOperation({ summary: '取消扫描草稿并删除其对象文件' })
  cancelScan(@CurrentSessionContext() session: CurrentSession, @Param('scanId') scanId: string) {
    return this.scans.cancel(session, scanId);
  }

  @Get('assets/:assetId/content')
  @ApiOperation({ summary: '读取当前岩馆的扫描资产内容' })
  async getAssetContent(
    @CurrentSessionContext() session: CurrentSession,
    @Param('assetId') assetId: string,
  ) {
    const { asset, stream } = await this.assets.getContent(session, assetId);
    return new StreamableFile(stream, {
      type: asset.contentType,
      length: asset.sizeBytes,
      disposition: 'inline',
    });
  }

  @Get('summary')
  @ApiOperation({ summary: '获取岩点分类、规格和库存指标' })
  getSummary(@CurrentSessionContext() session: CurrentSession) {
    return this.inventory.summary(session);
  }

  @Get('categories')
  @ApiOperation({ summary: '搜索当前岩馆的岩点用途分类' })
  listCategories(@CurrentSessionContext() session: CurrentSession, @Query() query: unknown) {
    return this.categories.list(session, parseListCategories(query));
  }

  @Post('categories')
  @ApiOperation({ summary: '创建不含规格和库存的岩点用途分类' })
  createCategory(@CurrentSessionContext() session: CurrentSession, @Body() body: unknown) {
    return this.categories.create(session, parseCreateCategory(body));
  }

  @Post('categories/defaults')
  @ApiOperation({ summary: '补齐岩馆缺少的系统用途分类' })
  ensureDefaultCategories(@CurrentSessionContext() session: CurrentSession) {
    return this.categories.ensureDefaults(session);
  }

  @Get('categories/:categoryId')
  @ApiOperation({ summary: '获取用途分类、规格和库存流水' })
  getCategory(
    @CurrentSessionContext() session: CurrentSession,
    @Param('categoryId') categoryId: string,
  ) {
    return this.categories.get(session, categoryId);
  }

  @Patch('categories/:categoryId')
  @ApiOperation({ summary: '编辑用途分类资料' })
  updateCategory(
    @CurrentSessionContext() session: CurrentSession,
    @Param('categoryId') categoryId: string,
    @Body() body: unknown,
  ) {
    return this.categories.update(session, categoryId, parseUpdateCategory(body));
  }

  @Post('categories/:categoryId/stop')
  @HttpCode(204)
  @ApiOperation({ summary: '停用零库存用途分类并保留编号和历史' })
  stopCategory(
    @CurrentSessionContext() session: CurrentSession,
    @Param('categoryId') categoryId: string,
  ) {
    return this.categories.stop(session, categoryId);
  }

  @Post('categories/:categoryId/restore')
  @HttpCode(204)
  @ApiOperation({ summary: '恢复停用的用途分类' })
  restoreCategory(
    @CurrentSessionContext() session: CurrentSession,
    @Param('categoryId') categoryId: string,
  ) {
    return this.categories.restore(session, categoryId);
  }

  @Delete('categories/:categoryId')
  @HttpCode(204)
  @ApiOperation({ summary: '永久删除零库存且从未入账的分类并释放编号' })
  deleteCategory(
    @CurrentSessionContext() session: CurrentSession,
    @Param('categoryId') categoryId: string,
  ) {
    return this.categories.deleteUnused(session, categoryId);
  }

  @Post('categories/:categoryId/specifications')
  @ApiOperation({ summary: '在用途分类下创建零库存岩点规格' })
  addSpecification(
    @CurrentSessionContext() session: CurrentSession,
    @Param('categoryId') categoryId: string,
    @Body() body: unknown,
  ) {
    return this.specifications.add(session, categoryId, parseAddSpecification(body));
  }

  @Post('categories/:categoryId/records')
  @ApiOperation({ summary: '以手工方式创建统一岩点档案，可选写入初始化实数' })
  addRecord(
    @CurrentSessionContext() session: CurrentSession,
    @Param('categoryId') categoryId: string,
    @Body() body: unknown,
  ) {
    return this.specifications.addRecord(session, categoryId, parseCreateHoldRecord(body));
  }

  @Patch('specifications/:specificationId')
  @ApiOperation({ summary: '修改岩点规格资料，不影响库存流水' })
  updateSpecification(
    @CurrentSessionContext() session: CurrentSession,
    @Param('specificationId') specificationId: string,
    @Body() body: unknown,
  ) {
    return this.specifications.update(session, specificationId, parseUpdateSpecification(body));
  }

  @Post('specifications/:specificationId/stop')
  @HttpCode(204)
  @ApiOperation({ summary: '停用零库存规格' })
  stopSpecification(
    @CurrentSessionContext() session: CurrentSession,
    @Param('specificationId') specificationId: string,
  ) {
    return this.specifications.stop(session, specificationId);
  }

  @Post('specifications/:specificationId/restore')
  @HttpCode(204)
  @ApiOperation({ summary: '恢复停用的规格' })
  restoreSpecification(
    @CurrentSessionContext() session: CurrentSession,
    @Param('specificationId') specificationId: string,
  ) {
    return this.specifications.restore(session, specificationId);
  }

  @Post('specifications/:specificationId/permanent-delete')
  @HttpCode(204)
  @ApiOperation({ summary: '永久隐藏岩点档案、清零库存并保留审计存根' })
  permanentlyDeleteSpecification(
    @CurrentSessionContext() session: CurrentSession,
    @Param('specificationId') specificationId: string,
    @Body() body: unknown,
  ) {
    return this.recordDeletion.permanentlyDelete(
      session,
      specificationId,
      parsePermanentlyDeleteSpecification(body),
    );
  }

  @Post('specifications/:specificationId/movements')
  @ApiOperation({ summary: '记录岩点规格的正常入库或库存调整' })
  recordMovement(
    @CurrentSessionContext() session: CurrentSession,
    @Param('specificationId') specificationId: string,
    @Body() body: unknown,
  ) {
    return this.inventory.recordMovement(session, specificationId, parseStockMovement(body));
  }

  @Post('specifications/:specificationId/initialize')
  @ApiOperation({ summary: '将现有完整规格加入当前初始化批次并校准实数' })
  initializeSpecification(
    @CurrentSessionContext() session: CurrentSession,
    @Param('specificationId') specificationId: string,
    @Body() body: unknown,
  ) {
    return this.initialization.initializeExisting(
      session,
      specificationId,
      parseInitializeSpecification(body),
    );
  }

  @Post('movements/:movementId/reverse')
  @ApiOperation({ summary: '通过反向流水撤销一笔正常到货入库' })
  reverseReceipt(
    @CurrentSessionContext() session: CurrentSession,
    @Param('movementId') movementId: string,
    @Body() body: unknown,
  ) {
    return this.inventory.reverseReceipt(session, movementId, parseReverseMovement(body));
  }
}
