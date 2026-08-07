import { Injectable, OnModuleInit } from '@nestjs/common';
import { Client } from 'minio';
import type { Readable } from 'node:stream';
import { readEnvironment } from '../config/environment';

@Injectable()
export class ObjectStorageService implements OnModuleInit {
  private readonly environment = readEnvironment();
  private readonly client = new Client({
    endPoint: this.environment.MINIO_ENDPOINT,
    port: this.environment.MINIO_PORT,
    useSSL: this.environment.MINIO_USE_SSL,
    accessKey: this.environment.MINIO_ACCESS_KEY,
    secretKey: this.environment.MINIO_SECRET_KEY,
  });

  async onModuleInit(): Promise<void> {
    const exists = await this.client.bucketExists(this.environment.MINIO_BUCKET);
    if (!exists) await this.client.makeBucket(this.environment.MINIO_BUCKET);
  }

  async put(objectKey: string, content: Buffer, contentType: string): Promise<void> {
    await this.client.putObject(this.environment.MINIO_BUCKET, objectKey, content, content.length, {
      'Content-Type': contentType,
    });
  }

  get(objectKey: string): Promise<Readable> {
    return this.client.getObject(this.environment.MINIO_BUCKET, objectKey);
  }

  async remove(objectKey: string): Promise<void> {
    await this.client.removeObject(this.environment.MINIO_BUCKET, objectKey);
  }
}
