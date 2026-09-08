import { Injectable, Logger, OnModuleInit, ServiceUnavailableException } from '@nestjs/common';
import { Client } from 'minio';
import type { Readable } from 'node:stream';
import { AppConfigService } from '../config/app-config.service';

const operationTimeoutMs = 5_000;

@Injectable()
export class ObjectStorageService implements OnModuleInit {
  private readonly logger = new Logger(ObjectStorageService.name);
  private readonly client: Client;
  private available = false;
  private lastError: string | null = null;

  constructor(private readonly config: AppConfigService) {
    const environment = config.values;
    this.client = new Client({
      endPoint: environment.MINIO_ENDPOINT,
      port: environment.MINIO_PORT,
      useSSL: environment.MINIO_USE_SSL,
      accessKey: environment.MINIO_ACCESS_KEY,
      secretKey: environment.MINIO_SECRET_KEY,
    });
  }

  async onModuleInit(): Promise<void> {
    try {
      await this.connect();
    } catch (error) {
      this.markUnavailable(error);
      if (this.config.values.OBJECT_STORAGE_REQUIRED) throw error;
      this.logger.warn('对象存储暂不可用；API 将以降级模式启动');
    }
  }

  async put(objectKey: string, content: Buffer, contentType: string): Promise<void> {
    await this.ensureAvailable();
    try {
      await withTimeout(
        this.client.putObject(this.config.values.MINIO_BUCKET, objectKey, content, content.length, {
          'Content-Type': contentType,
        }),
      );
    } catch (error) {
      this.markUnavailable(error);
      throw unavailableError();
    }
  }

  async putStream(
    objectKey: string,
    content: Readable,
    sizeBytes: number,
    contentType: string,
  ): Promise<void> {
    await this.ensureAvailable();
    try {
      await withTimeout(
        this.client.putObject(this.config.values.MINIO_BUCKET, objectKey, content, sizeBytes, {
          'Content-Type': contentType,
        }),
        120_000,
      );
    } catch (error) {
      this.markUnavailable(error);
      throw unavailableError();
    }
  }

  async get(objectKey: string): Promise<Readable> {
    await this.ensureAvailable();
    try {
      return await withTimeout(this.client.getObject(this.config.values.MINIO_BUCKET, objectKey));
    } catch (error) {
      this.markUnavailable(error);
      throw unavailableError();
    }
  }

  async getPartial(objectKey: string, offset: number, length: number): Promise<Readable> {
    await this.ensureAvailable();
    try {
      return await withTimeout(
        this.client.getPartialObject(this.config.values.MINIO_BUCKET, objectKey, offset, length),
      );
    } catch (error) {
      this.markUnavailable(error);
      throw unavailableError();
    }
  }

  async remove(objectKey: string): Promise<void> {
    await this.ensureAvailable();
    try {
      await withTimeout(this.client.removeObject(this.config.values.MINIO_BUCKET, objectKey));
    } catch (error) {
      this.markUnavailable(error);
      throw unavailableError();
    }
  }

  readiness() {
    return { available: this.available, lastError: this.lastError };
  }

  async probe(): Promise<boolean> {
    try {
      await this.connect();
      return true;
    } catch (error) {
      this.markUnavailable(error);
      return false;
    }
  }

  private async connect(): Promise<void> {
    const bucket = this.config.values.MINIO_BUCKET;
    const exists = await withTimeout(this.client.bucketExists(bucket));
    if (!exists) await withTimeout(this.client.makeBucket(bucket));
    this.available = true;
    this.lastError = null;
  }

  private async ensureAvailable(): Promise<void> {
    if (this.available) return;
    if (!(await this.probe())) throw unavailableError();
  }

  private markUnavailable(error: unknown): void {
    this.available = false;
    this.lastError = error instanceof Error ? error.message.slice(0, 500) : 'unknown error';
  }
}

function unavailableError(): ServiceUnavailableException {
  return new ServiceUnavailableException('对象存储暂时不可用，请稍后重试');
}

async function withTimeout<T>(promise: Promise<T>, timeoutMs = operationTimeoutMs): Promise<T> {
  let timer: NodeJS.Timeout | undefined;
  try {
    return await Promise.race([
      promise,
      new Promise<never>((_resolve, reject) => {
        timer = setTimeout(
          () => reject(new Error('object storage operation timed out')),
          timeoutMs,
        );
      }),
    ]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}
