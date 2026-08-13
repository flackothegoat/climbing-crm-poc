import { Injectable } from '@nestjs/common';
import type { Prisma } from '@prisma/client';
import { PrismaService } from '../database/prisma.service';
import { RequestContextService } from './request-context.service';

export interface AuditInput {
  organizationId?: string;
  actorAccountId?: string;
  type: string;
  outcome: 'SUCCESS' | 'FAILURE';
  metadata?: Prisma.InputJsonValue;
}

@Injectable()
export class AuditService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly requestContext: RequestContextService,
  ) {}

  record(input: AuditInput, client: AuditClient = this.prisma): Promise<unknown> {
    return client.auditEvent.create({
      data: { ...input, correlationId: this.requestContext.correlationId() },
    });
  }
}

type AuditClient = Pick<PrismaService, 'auditEvent'> | Prisma.TransactionClient;
