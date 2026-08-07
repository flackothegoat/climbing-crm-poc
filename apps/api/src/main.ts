import cookie from '@fastify/cookie';
import multipart from '@fastify/multipart';
import { Logger } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { FastifyAdapter, NestFastifyApplication } from '@nestjs/platform-fastify';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import { config as loadDotenv } from 'dotenv';
import { resolve } from 'node:path';
import { AppModule } from './app.module';
import { readEnvironment } from './config/environment';

export const CORS_ALLOWED_METHODS = ['GET', 'HEAD', 'POST', 'PATCH', 'DELETE', 'OPTIONS'];

loadDotenv({ path: resolve(process.cwd(), '../../.env') });
loadDotenv({ path: resolve(process.cwd(), '.env') });

export async function createApplication(): Promise<NestFastifyApplication> {
  const app = await NestFactory.create<NestFastifyApplication>(AppModule, new FastifyAdapter());
  const env = readEnvironment();
  await app.register(cookie);
  await app.register(multipart, { limits: { files: 1, fileSize: 20 * 1024 * 1024 } });
  app.enableCors({
    origin: env.WEB_ORIGIN,
    credentials: true,
    methods: CORS_ALLOWED_METHODS,
  });
  app.setGlobalPrefix('api');
  const document = SwaggerModule.createDocument(
    app,
    new DocumentBuilder()
      .setTitle('Climbing CRM POC API')
      .setVersion('0.1.0')
      .addCookieAuth(env.SESSION_COOKIE_NAME)
      .build(),
  );
  SwaggerModule.setup('api/docs', app, document);
  return app;
}

async function bootstrap(): Promise<void> {
  const app = await createApplication();
  await app.listen(readEnvironment().API_PORT, '0.0.0.0');
  Logger.log('API listening', 'Bootstrap');
}

if (!process.env.VITEST) void bootstrap();
