import {
  ConflictException,
  Injectable,
  Logger,
  NotFoundException,
  OnModuleDestroy,
  OnModuleInit,
} from '@nestjs/common';
import { HoldAssetKind, HoldModelProcessingStatus, HoldScanStatus, Prisma } from '@prisma/client';
import { execFile } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { existsSync } from 'node:fs';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { basename, join, resolve } from 'node:path';
import { buffer } from 'node:stream/consumers';
import { promisify } from 'node:util';
import type { CurrentSession } from '../auth/session.service';
import { PrismaService } from '../database/prisma.service';
import { AccessControlService, Capability } from '../security/access-control.service';
import { ObjectCleanupService } from '../storage/object-cleanup.service';
import { ObjectStorageService } from '../storage/object-storage.service';
import { validateHoldAsset } from './hold-asset-file';

const executeFile = promisify(execFile);
const pollIntervalMs = 2_000;
const staleProcessingMs = 10 * 60_000;

@Injectable()
export class HoldModelProcessingService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(HoldModelProcessingService.name);
  private timer?: NodeJS.Timeout;
  private running = false;

  constructor(
    private readonly prisma: PrismaService,
    private readonly storage: ObjectStorageService,
    private readonly cleanup: ObjectCleanupService,
    private readonly access: AccessControlService,
  ) {}

  async onModuleInit(): Promise<void> {
    if (process.env.NODE_ENV === 'test' || process.env.HOLD_MODEL_PROCESSING_ENABLED === 'false') {
      return;
    }
    await this.recoverStaleJobs();
    this.timer = setInterval(() => void this.tick(), pollIntervalMs);
    this.timer.unref();
    void this.tick();
  }

  onModuleDestroy(): void {
    if (this.timer) clearInterval(this.timer);
  }

  async getForScan(session: CurrentSession, scanId: string) {
    this.access.assert(session, Capability.HOLD_READ);
    const job = await this.prisma.holdModelProcessingJob.findFirst({
      where: { scanId, organizationId: session.organization.id },
      include: { outputAsset: true },
      orderBy: { createdAt: 'desc' },
    });
    if (!job) throw new NotFoundException('模型处理任务不存在');
    return toProcessingJob(job);
  }

  async retry(session: CurrentSession, jobId: string) {
    this.access.assert(session, Capability.HOLD_WRITE);
    const updated = await this.prisma.holdModelProcessingJob.updateMany({
      where: {
        id: jobId,
        organizationId: session.organization.id,
        status: HoldModelProcessingStatus.FAILED,
      },
      data: {
        status: HoldModelProcessingStatus.QUEUED,
        errorCode: null,
        errorMessage: null,
        startedAt: null,
        completedAt: null,
      },
    });
    if (!updated.count) throw new ConflictException('只有失败的模型处理任务可以重试');
    void this.tick();
    const job = await this.prisma.holdModelProcessingJob.findUniqueOrThrow({
      where: { id: jobId },
      include: { outputAsset: true },
    });
    return toProcessingJob(job);
  }

  private async tick(): Promise<void> {
    if (this.running) return;
    this.running = true;
    try {
      const job = await this.claimNext();
      if (job) await this.process(job);
    } catch (error) {
      this.logger.error('后台岩点模型处理轮询失败', error);
    } finally {
      this.running = false;
    }
  }

  private async claimNext() {
    const candidate = await this.prisma.holdModelProcessingJob.findFirst({
      where: { status: HoldModelProcessingStatus.QUEUED },
      orderBy: { createdAt: 'asc' },
      select: { id: true },
    });
    if (!candidate) return null;
    const claimed = await this.prisma.holdModelProcessingJob.updateMany({
      where: { id: candidate.id, status: HoldModelProcessingStatus.QUEUED },
      data: {
        status: HoldModelProcessingStatus.PROCESSING,
        attemptCount: { increment: 1 },
        startedAt: new Date(),
        completedAt: null,
      },
    });
    if (!claimed.count) return null;
    return this.prisma.holdModelProcessingJob.findUniqueOrThrow({
      where: { id: candidate.id },
      include: { sourceAsset: true, scan: { select: { status: true } } },
    });
  }

  private async process(job: Awaited<ReturnType<HoldModelProcessingService['claimNext']>>) {
    if (!job) return;
    if (job.scan.status === HoldScanStatus.CANCELLED) {
      await this.finishCancelled(job.id);
      return;
    }
    const directory = await mkdtemp(join(tmpdir(), 'hold-model-'));
    const sourcePath = join(directory, 'source.glb');
    const outputPath = join(directory, 'catalog.glb');
    const reportPath = join(directory, 'report.json');
    let outputObjectKey = '';
    try {
      const sourceStream = await this.storage.get(job.sourceAsset.objectKey);
      await writeFile(sourcePath, await buffer(sourceStream));
      await runProcessor(sourcePath, outputPath, reportPath);
      const [output, reportContent] = await Promise.all([
        readFile(outputPath),
        readFile(reportPath, 'utf8'),
      ]);
      const report = parseProcessorReport(reportContent);
      const validated = validateHoldAsset(
        HoldAssetKind.MODEL_3D,
        outputFileName(job.sourceAsset.originalFileName),
        output,
      );
      outputObjectKey = buildProcessedObjectKey(job.organizationId, job.scanId);
      await this.storage.put(outputObjectKey, output, validated.contentType);
      const status = report.warnings.length
        ? HoldModelProcessingStatus.NEEDS_REVIEW
        : HoldModelProcessingStatus.COMPLETED;
      await this.prisma.$transaction(async (transaction) => {
        const current = await transaction.holdModelProcessingJob.findUniqueOrThrow({
          where: { id: job.id },
          include: { sourceAsset: true, scan: { select: { status: true } } },
        });
        if (
          current.status !== HoldModelProcessingStatus.PROCESSING ||
          current.scan.status === HoldScanStatus.CANCELLED
        ) {
          throw new ProcessingCancelledError();
        }
        const asset = await transaction.holdAsset.create({
          data: {
            organizationId: current.organizationId,
            scanId: current.scanId,
            specificationId: current.sourceAsset.specificationId,
            kind: HoldAssetKind.MODEL_3D,
            objectKey: outputObjectKey,
            originalFileName: validated.originalFileName,
            contentType: validated.contentType,
            sizeBytes: output.length,
            checksumSha256: validated.checksumSha256,
            metadata: {
              ...validated.metadata,
              processing: report as unknown as Prisma.InputJsonValue,
            } as Prisma.InputJsonValue,
            sourceAssetId: current.sourceAssetId,
            createdByAccountId: current.requestedByAccountId,
          },
        });
        await transaction.holdModelProcessingJob.update({
          where: { id: current.id },
          data: {
            outputAssetId: asset.id,
            status,
            report: report as unknown as Prisma.InputJsonValue,
            errorCode: null,
            errorMessage: null,
            completedAt: new Date(),
          },
        });
      });
      outputObjectKey = '';
    } catch (error) {
      if (outputObjectKey) await this.removeObjectQuietly(outputObjectKey);
      if (error instanceof ProcessingCancelledError) {
        await this.finishCancelled(job.id);
      } else {
        await this.fail(job.id, error);
      }
    } finally {
      await rm(directory, { force: true, recursive: true });
    }
  }

  private async recoverStaleJobs(): Promise<void> {
    const threshold = new Date(Date.now() - staleProcessingMs);
    await this.prisma.holdModelProcessingJob.updateMany({
      where: { status: HoldModelProcessingStatus.PROCESSING, startedAt: { lt: threshold } },
      data: {
        status: HoldModelProcessingStatus.QUEUED,
        errorCode: 'WORKER_INTERRUPTED',
        errorMessage: '处理进程曾中断，已自动重新排队',
        startedAt: null,
      },
    });
  }

  private finishCancelled(id: string) {
    return this.prisma.holdModelProcessingJob.updateMany({
      where: {
        id,
        status: { in: [HoldModelProcessingStatus.QUEUED, HoldModelProcessingStatus.PROCESSING] },
      },
      data: { status: HoldModelProcessingStatus.CANCELLED, completedAt: new Date() },
    });
  }

  private async fail(id: string, error: unknown): Promise<void> {
    const details = processingError(error);
    this.logger.warn(`岩点模型处理失败: ${id} (${details.code})`);
    await this.prisma.holdModelProcessingJob.updateMany({
      where: { id, status: HoldModelProcessingStatus.PROCESSING },
      data: {
        status: HoldModelProcessingStatus.FAILED,
        errorCode: details.code,
        errorMessage: details.message,
        completedAt: new Date(),
      },
    });
  }

  private async removeObjectQuietly(objectKey: string): Promise<void> {
    try {
      await this.storage.remove(objectKey);
    } catch (error) {
      await this.cleanup.enqueue(objectKey, 'hold-model-processing-compensation', error);
    }
  }
}

class ProcessingCancelledError extends Error {}

function processorPath(): string {
  const configured = process.env.HOLD_MODEL_PROCESSOR_PATH;
  const candidates = configured
    ? [resolve(configured)]
    : [
        resolve(process.cwd(), 'apps/api/scripts/hold-model-processor.py'),
        resolve(process.cwd(), 'scripts/hold-model-processor.py'),
      ];
  const found = candidates.find(existsSync);
  if (!found) throw new Error('PROCESSOR_NOT_INSTALLED');
  return found;
}

async function runProcessor(source: string, output: string, report: string): Promise<void> {
  await executeFile('python3', [processorPath(), source, '--output', output, '--report', report], {
    timeout: 90_000,
    maxBuffer: 1024 * 1024,
    windowsHide: true,
  });
}

interface ProcessorReport {
  processorVersion: number;
  scope: 'CATALOG_PREVIEW';
  sourceTriangles: number;
  keptTriangles: number;
  removedTriangles: number;
  keptRatio: number;
  warnings: string[];
  settingReady: false;
  [key: string]: unknown;
}

function parseProcessorReport(value: string): ProcessorReport {
  const report = JSON.parse(value) as ProcessorReport;
  if (
    report.processorVersion !== 1 ||
    report.scope !== 'CATALOG_PREVIEW' ||
    !Array.isArray(report.warnings)
  ) {
    throw new Error('PROCESSOR_REPORT_INVALID');
  }
  return report;
}

function processingError(error: unknown) {
  const raw = error instanceof Error ? error.message : 'UNKNOWN';
  const token = raw.match(/[A-Z][A-Z0-9_]{2,}/)?.[0] ?? 'PROCESSOR_FAILED';
  const friendly: Record<string, string> = {
    GLB_EXPECTS_SINGLE_MESH: '当前自动清理仅支持单网格模型，原始模型已保留',
    GLB_REQUIRES_POSITION_AND_UV: '模型缺少清理所需的几何或纹理信息，原始模型已保留',
    SUPPORT_PLANE_NOT_FOUND: '没有识别到稳定的拍摄承托平面，请人工检查原始模型',
    SUPPORT_PLANE_UNSTABLE: '承托平面噪声过大，请人工检查原始模型',
    SEGMENTATION_OUT_OF_RANGE: '自动分离结果不可信，未覆盖原始模型',
    PROCESSOR_NOT_INSTALLED: '模型处理器未安装，任务可在修复后重试',
  };
  return {
    code: token.slice(0, 80),
    message: friendly[token] ?? '自动清理失败，原始模型和库存档案不受影响',
  };
}

function outputFileName(source: string): string {
  return `${basename(source, '.glb')}-catalog.glb`;
}

function buildProcessedObjectKey(organizationId: string, scanId: string): string {
  return `${organizationId}/hold-scans/${scanId}/processed/${randomUUID()}.glb`;
}

export function toProcessingJob(job: {
  id: string;
  status: HoldModelProcessingStatus;
  attemptCount: number;
  processorVersion: number;
  sourceAssetId: string;
  outputAssetId: string | null;
  errorCode: string | null;
  errorMessage: string | null;
  report: Prisma.JsonValue | null;
  createdAt: Date;
  updatedAt: Date;
}) {
  return {
    id: job.id,
    status: job.status,
    attemptCount: job.attemptCount,
    processorVersion: job.processorVersion,
    sourceAssetId: job.sourceAssetId,
    outputAssetId: job.outputAssetId,
    errorCode: job.errorCode,
    errorMessage: job.errorMessage,
    report: job.report,
    createdAt: job.createdAt.toISOString(),
    updatedAt: job.updatedAt.toISOString(),
  };
}
